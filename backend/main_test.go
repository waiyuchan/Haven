package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

const validFixture = `{"settings":{"beds":12},"residents":[{"id":"r1"}],"plans":[{"id":"p1","unit":"weekly","price":24900,"deposit":25000,"term":44}],"contracts":[],"invoices":[{"id":"i1","residentId":"r1","total":49800,"items":[{"quantity":2,"unitPrice":24900}]}],"tickets":[],"assets":[],"facilities":[{"id":"f1","capacity":12}],"reservations":[],"posts":[],"messages":[],"mail":[]}`

func TestOptimisticConcurrencyAndDurability(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state.json")
	s := &Store{file: file, state: Envelope{Data: json.RawMessage("null")}}
	var wg sync.WaitGroup
	statuses := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _ := json.Marshal(Envelope{Revision: 0, Data: json.RawMessage(validFixture)})
			r := httptest.NewRequest(http.MethodPut, "/api/state", bytes.NewReader(body))
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			statuses <- w.Code
		}()
	}
	wg.Wait()
	close(statuses)
	success := 0
	conflict := 0
	for code := range statuses {
		if code == 200 {
			success++
		} else if code == 409 {
			conflict++
		} else {
			t.Fatalf("unexpected status %d", code)
		}
	}
	if success != 1 || conflict != 19 {
		t.Fatalf("lost update protection failed: %d saved, %d conflicts", success, conflict)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var recovered Envelope
	if json.Unmarshal(data, &recovered) != nil || recovered.Revision != 1 {
		t.Fatal("invalid durable state")
	}
	if err := validate(recovered.Data); err != nil {
		t.Fatal(err)
	}
}
func TestInvalidInvoiceDoesNotReplaceSavedState(t *testing.T) {
	s := &Store{file: filepath.Join(t.TempDir(), "state.json"), state: Envelope{Revision: 7, Data: json.RawMessage(validFixture)}}
	invalid := bytes.ReplaceAll([]byte(validFixture), []byte(`"total":49800`), []byte(`"total":24900`))
	body, _ := json.Marshal(Envelope{Revision: 7, Data: invalid})
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/state", bytes.NewReader(body)))
	if w.Code != 422 || s.state.Revision != 7 {
		t.Fatal("invalid invoice changed saved state")
	}
}
func TestFacilityOverlapAndAdjacentBookings(t *testing.T) {
	var data map[string]any
	json.Unmarshal([]byte(validFixture), &data)
	data["reservations"] = []any{map[string]any{"id": "b1", "facilityId": "f1", "residentId": "r1", "date": "2026-11-08", "start": "19:00", "end": "20:00", "attendees": 2, "status": "confirmed"}, map[string]any{"id": "b2", "facilityId": "f1", "residentId": "r1", "date": "2026-11-08", "start": "19:30", "end": "20:30", "attendees": 1, "status": "confirmed"}}
	raw, _ := json.Marshal(data)
	if validate(raw) == nil {
		t.Fatal("overlap accepted")
	}
	data["reservations"].([]any)[1].(map[string]any)["start"] = "20:00"
	raw, _ = json.Marshal(data)
	if err := validate(raw); err != nil {
		t.Fatalf("adjacent booking rejected: %v", err)
	}
}

func TestSharedCapacityAndQueueLifecycle(t *testing.T) {
	var s obj
	json.Unmarshal(seedJSON, &s)
	f := find(s, "facilities", "f5")
	f["capacity"] = float64(2)
	a := Actor{Role: "resident", ResidentID: "r1"}
	b := Actor{Role: "resident", ResidentID: "r2"}
	c := Actor{Role: "resident", ResidentID: "r3"}
	command := obj{"action": "book", "facilityId": "f5", "date": "2026-11-06", "start": "19:00", "end": "20:00", "attendees": float64(1)}
	var err error
	s, err = facilityActionGo(s, a, command)
	if err != nil {
		t.Fatal(err)
	}
	s, err = facilityActionGo(s, b, command)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = facilityActionGo(s, c, command); err == nil {
		t.Fatal("shared capacity exceeded")
	}
	activate := obj{"action": "activate", "facilityId": "f7", "attendees": float64(1)}
	s, err = facilityActionGo(s, a, activate)
	if err != nil {
		t.Fatal(err)
	}
	s, err = facilityActionGo(s, b, obj{"action": "queue", "facilityId": "f7", "attendees": float64(1)})
	if err != nil {
		t.Fatal(err)
	}
	uid := str(object(rows(s, "facilityUsage")[0]), "id")
	if _, err = facilityActionGo(s, b, obj{"action": "release", "facilityId": "f7", "usageId": uid}); err == nil {
		t.Fatal("cross-resident release allowed")
	}
	s, err = facilityActionGo(s, a, obj{"action": "release", "facilityId": "f7", "usageId": uid})
	if err != nil {
		t.Fatal(err)
	}
	if str(object(rows(s, "queueEntries")[0]), "status") != "ready" {
		t.Fatal("queue did not advance")
	}
	s, err = facilityActionGo(s, b, activate)
	if err != nil {
		t.Fatal(err)
	}
	view := projectGo(s, a)
	if len(rows(view, "residents")) != 1 || len(rows(view, "facilityUsage")) != 1 {
		t.Fatal("resident projection leaked records")
	}
}
