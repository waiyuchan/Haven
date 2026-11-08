package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Envelope struct {
	Revision int64           `json:"revision"`
	Data     json.RawMessage `json:"data"`
}
type Store struct {
	mu    sync.Mutex
	file  string
	state Envelope
}

func amount(n float64) bool { return n >= 0 && n <= 100000000 && n == math.Trunc(n) }
func validate(raw json.RawMessage) error {
	var s struct {
		Settings  map[string]any `json:"settings"`
		Residents []struct {
			ID string `json:"id"`
		} `json:"residents"`
		Plans []struct {
			ID, Unit             string
			Price, Deposit, Term float64
		} `json:"plans"`
		Contracts []struct {
			ResidentID string `json:"residentId"`
			Start, End string
			Snapshot   struct{ Price, Term, Total float64 }
		} `json:"contracts"`
		Invoices []struct {
			ResidentID string `json:"residentId"`
			Total      float64
			Items      []struct {
				Quantity  float64
				UnitPrice float64 `json:"unitPrice"`
			}
		} `json:"invoices"`
		Tickets []struct {
			ResidentID string `json:"residentId"`
		} `json:"tickets"`
		Assets []struct {
			Cost, Salvage, Life, Quantity float64
			Purchased                     string
		} `json:"assets"`
		Facilities []struct {
			ID       string
			Capacity int
		} `json:"facilities"`
		Reservations []struct {
			ID                       string
			FacilityID               string `json:"facilityId"`
			ResidentID               string `json:"residentId"`
			Date, Start, End, Status string
			Attendees                int
		} `json:"reservations"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return err
	}
	var sections map[string]json.RawMessage
	if json.Unmarshal(raw, &sections) != nil || s.Settings == nil {
		return errors.New("invalid state")
	}
	for _, key := range []string{"residents", "plans", "contracts", "invoices", "tickets", "assets", "facilities", "reservations", "posts", "messages", "mail"} {
		var rows []struct{ ID string }
		if len(sections[key]) == 0 || string(sections[key]) == "null" || json.Unmarshal(sections[key], &rows) != nil || len(rows) > 2000 {
			return fmt.Errorf("invalid %s", key)
		}
		ids := map[string]bool{}
		for _, row := range rows {
			if row.ID == "" || ids[row.ID] {
				return errors.New("duplicate or missing id")
			}
			ids[row.ID] = true
		}
	}
	residents := map[string]bool{}
	for _, r := range s.Residents {
		residents[r.ID] = true
	}
	for _, p := range s.Plans {
		if !amount(p.Price) || p.Price == 0 || !amount(p.Deposit) || p.Term < 1 || p.Term > 520 || p.Term != math.Trunc(p.Term) || (p.Unit != "weekly" && p.Unit != "monthly") {
			return errors.New("invalid plan")
		}
	}
	for _, c := range s.Contracts {
		_, e1 := time.Parse("2006-01-02", c.Start)
		_, e2 := time.Parse("2006-01-02", c.End)
		if !residents[c.ResidentID] || !amount(c.Snapshot.Total) || c.Snapshot.Total != c.Snapshot.Price*c.Snapshot.Term || e1 != nil || e2 != nil || c.Start >= c.End {
			return errors.New("invalid contract")
		}
	}
	for _, i := range s.Invoices {
		sum := 0.0
		if !residents[i.ResidentID] || len(i.Items) == 0 {
			return errors.New("invalid invoice")
		}
		for _, l := range i.Items {
			if !amount(l.UnitPrice) || l.Quantity < 1 || l.Quantity != math.Trunc(l.Quantity) {
				return errors.New("invalid invoice line")
			}
			sum += l.UnitPrice * l.Quantity
		}
		if !amount(i.Total) || i.Total != sum {
			return errors.New("invoice total mismatch")
		}
	}
	for _, a := range s.Assets {
		_, dateErr := time.Parse("2006-01-02", a.Purchased)
		if !amount(a.Cost) || !amount(a.Salvage) || a.Salvage > a.Cost || a.Life <= 0 || a.Life > 100 || a.Quantity < 1 || a.Quantity != math.Trunc(a.Quantity) || dateErr != nil {
			return errors.New("invalid asset")
		}
	}
	for _, t := range s.Tickets {
		if !residents[t.ResidentID] {
			return errors.New("invalid ticket resident")
		}
	}
	capacities := map[string]int{}
	for _, f := range s.Facilities {
		if f.Capacity < 1 || f.Capacity > 500 {
			return errors.New("invalid capacity")
		}
		capacities[f.ID] = f.Capacity
	}
	for index, b := range s.Reservations {
		_, dateErr := time.Parse("2006-01-02", b.Date)
		_, startErr := time.Parse("15:04", b.Start)
		_, endErr := time.Parse("15:04", b.End)
		if capacities[b.FacilityID] == 0 || !residents[b.ResidentID] || b.Attendees < 1 || b.Attendees > capacities[b.FacilityID] || b.Start >= b.End || dateErr != nil || startErr != nil || endErr != nil {
			return errors.New("invalid reservation")
		}
		for _, other := range s.Reservations[index+1:] {
			if sections["schemaVersion"] == nil && b.Status != "cancelled" && other.Status != "cancelled" && b.FacilityID == other.FacilityID && b.Date == other.Date && b.Start < other.End && b.End > other.Start {
				return errors.New("facility time already reserved")
			}
		}
	}
	var versioned map[string]any
	json.Unmarshal(raw, &versioned)
	return validateV2(versioned)
}
func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
func (s *Store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.mu.Lock()
		defer s.mu.Unlock()
		reply(w, 200, s.state)
		return
	}
	if r.Method != http.MethodPut {
		reply(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	body := http.MaxBytesReader(w, r.Body, 1500000)
	defer body.Close()
	var next Envelope
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(&next); err != nil {
		reply(w, 400, map[string]string{"error": "invalid JSON"})
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		reply(w, 400, map[string]string{"error": "trailing data"})
		return
	}
	s.save(w, next, "")
}
func (s *Store) save(w http.ResponseWriter, next Envelope, accessCode string) {
	if err := validate(next.Data); err != nil {
		reply(w, 422, map[string]string{"error": err.Error()})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if next.Revision != s.state.Revision {
		reply(w, 409, map[string]string{"error": "Another page updated this record. Refresh and try again."})
		return
	}
	next.Revision++
	bytes, err := json.Marshal(next)
	if err == nil {
		err = os.MkdirAll(filepath.Dir(s.file), 0700)
	}
	if err == nil {
		err = os.WriteFile(s.file+".tmp", bytes, 0600)
	}
	if err == nil {
		err = os.Rename(s.file+".tmp", s.file)
	}
	if err != nil {
		log.Printf("persistence error: %v", err)
		reply(w, 500, map[string]string{"error": "The record could not be saved."})
		return
	}
	s.state = next
	result := obj{"revision": next.Revision}
	if accessCode != "" {
		result["accessCode"] = accessCode
	}
	reply(w, 200, result)
}
func main() {
	file := os.Getenv("DBSSA_DATA")
	if file == "" {
		file = "data/state.json"
	}
	store := &Store{file: file, state: Envelope{Data: json.RawMessage("null")}}
	if data, err := os.ReadFile(file); err == nil {
		if json.Unmarshal(data, &store.state) != nil {
			log.Fatal("invalid state file")
		}
	} else if !os.IsNotExist(err) {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	var data map[string]any
	if string(store.state.Data) == "null" || len(store.state.Data) == 0 {
		json.Unmarshal(seedJSON, &data)
	} else {
		json.Unmarshal(store.state.Data, &data)
	}
	data = migrateGo(data)
	store.state.Data, _ = json.Marshal(data)
	registerPortal(mux, store)
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 401, map[string]string{"error": "Use a portal sign-in entry"})
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 200, map[string]string{"status": "ok", "backend": "go"})
	})
	mux.Handle("/portal/", http.StripPrefix("/portal/", http.FileServer(http.Dir("public/portal"))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "public/portal/index.html") })
	addr := os.Getenv("DBSSA_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8088"
	}
	log.Printf("Haven Go demo: http://%s", addr)
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	log.Fatal(server.ListenAndServe())
}
