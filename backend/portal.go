package main

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed seed.json
var seedJSON []byte

type obj = map[string]any

func rows(s obj, key string) []any   { a, _ := s[key].([]any); return a }
func object(v any) obj               { a, _ := v.(map[string]any); return a }
func str(s obj, k string) string     { v, _ := s[k].(string); return v }
func number(s obj, k string) float64 { v, _ := s[k].(float64); return v }
func find(s obj, key, id string) obj {
	for _, v := range rows(s, key) {
		a := object(v)
		if str(a, "id") == id {
			return a
		}
	}
	return nil
}
func appendRow(s obj, key string, v any) { s[key] = append(rows(s, key), v) }
func clone(s obj) obj                    { b, _ := json.Marshal(s); var c obj; json.Unmarshal(b, &c); return c }
func freshID(prefix string) string {
	b := make([]byte, 12)
	rand.Read(b)
	return prefix + "-" + hex.EncodeToString(b)
}
func stamp() string                 { return time.Now().UTC().Format(time.RFC3339Nano) }
func parseStamp(s string) time.Time { t, _ := time.Parse(time.RFC3339Nano, s); return t }
func usageLive(u obj) bool {
	return str(u, "status") == "active" && parseStamp(str(u, "expiresAt")).After(time.Now())
}
func liveUsage(s obj, fid string) []obj {
	var a []obj
	for _, v := range rows(s, "facilityUsage") {
		u := object(v)
		if str(u, "facilityId") == fid && usageLive(u) {
			a = append(a, u)
		}
	}
	return a
}
func queueRows(s obj, fid string) []obj {
	a := []obj{}
	for _, v := range rows(s, "queueEntries") {
		q := object(v)
		if str(q, "facilityId") == fid && (str(q, "status") == "waiting" || str(q, "status") == "ready") {
			a = append(a, q)
		}
	}
	sort.Slice(a, func(i, j int) bool {
		if number(a[i], "sequence") != number(a[j], "sequence") {
			return number(a[i], "sequence") < number(a[j], "sequence")
		}
		if str(a[i], "createdAt") == str(a[j], "createdAt") {
			return str(a[i], "id") < str(a[j], "id")
		}
		return str(a[i], "createdAt") < str(a[j], "createdAt")
	})
	return a
}
func groupCost(f, u obj) float64 {
	if str(f, "bookingMode") == "exclusive" {
		return number(f, "capacity")
	}
	return number(u, "attendees")
}
func migrateGo(s obj) obj {
	if number(s, "schemaVersion") >= 2 {
		return migrateEnglishGo(migrateAccessGo(s))
	}
	var seed obj
	json.Unmarshal(seedJSON, &seed)
	for _, key := range []string{"rooms", "queueEntries", "facilityUsage", "accessEvents"} {
		s[key] = seed[key]
	}
	defaults := map[string]obj{}
	for _, v := range rows(seed, "facilities") {
		f := object(v)
		defaults[str(f, "id")] = f
	}
	for _, v := range rows(s, "facilities") {
		f := object(v)
		d := defaults[str(f, "id")]
		if d == nil {
			d = obj{"resourceType": "space", "bookingMode": "exclusive", "enabled": true, "activationMinutes": float64(60)}
		}
		for _, k := range []string{"resourceType", "bookingMode", "enabled", "activationMinutes"} {
			f[k] = d[k]
		}
	}
	for _, v := range rows(seed, "facilities") {
		f := object(v)
		if find(s, "facilities", str(f, "id")) == nil {
			appendRow(s, "facilities", f)
		}
	}
	object(s["settings"])["facilityTime"] = "19:00"
	s["schemaVersion"] = float64(2)
	return migrateEnglishGo(migrateAccessGo(s))
}
func validateV2(s obj) error {
	if number(s, "schemaVersion") < 2 {
		return nil
	}
	names := map[string]bool{}
	for _, v := range rows(s, "rooms") {
		r := object(v)
		n := strings.ToLower(str(r, "number"))
		if n == "" || names[n] {
			return errors.New("room numbers must be unique")
		}
		names[n] = true
	}
	for _, v := range rows(s, "facilities") {
		f := object(v)
		if (str(f, "resourceType") != "space" && str(f, "resourceType") != "equipment") || (str(f, "bookingMode") != "exclusive" && str(f, "bookingMode") != "shared") || number(f, "activationMinutes") < 5 || number(f, "activationMinutes") > 240 {
			return errors.New("invalid facility configuration")
		}
		events := map[string][]struct {
			at string
			n  float64
		}{}
		for _, item := range rows(s, "reservations") {
			b := object(item)
			if str(b, "facilityId") != str(f, "id") || (str(b, "status") != "confirmed" && str(b, "status") != "active") {
				continue
			}
			day := str(b, "date")
			n := groupCost(f, b)
			events[day] = append(events[day], struct {
				at string
				n  float64
			}{str(b, "start"), n}, struct {
				at string
				n  float64
			}{str(b, "end"), -n})
		}
		for _, e := range events {
			sort.Slice(e, func(i, j int) bool {
				if e[i].at == e[j].at {
					return e[i].n < e[j].n
				}
				return e[i].at < e[j].at
			})
			n := 0.0
			for _, x := range e {
				n += x.n
				if n > number(f, "capacity") {
					return errors.New("this time is fully booked")
				}
			}
		}
		n := 0.0
		for _, u := range liveUsage(s, str(f, "id")) {
			n += groupCost(f, u)
		}
		if n > number(f, "capacity") {
			return errors.New("facility capacity exceeded")
		}
	}
	for _, key := range []string{"queueEntries", "facilityUsage"} {
		ids := map[string]bool{}
		for _, v := range rows(s, key) {
			a := object(v)
			if ids[str(a, "id")] || find(s, "residents", str(a, "residentId")) == nil || find(s, "facilities", str(a, "facilityId")) == nil {
				return errors.New("invalid facility record")
			}
			ids[str(a, "id")] = true
		}
	}
	return nil
}
func reconcileGo(s obj) {
	for _, v := range rows(s, "facilityUsage") {
		u := object(v)
		if str(u, "status") == "active" && !usageLive(u) {
			u["status"] = "expired"
		}
	}
	for _, v := range rows(s, "facilities") {
		f := object(v)
		fid := str(f, "id")
		for _, q := range queueRows(s, fid) {
			if str(q, "status") == "ready" && !parseStamp(str(q, "readyUntil")).After(time.Now()) {
				q["status"] = "expired"
			}
		}
		available := number(f, "capacity")
		loc, _ := time.LoadLocation("Europe/London")
		day := time.Now().In(loc).Format("2006-01-02")
		at := str(object(s["settings"]), "facilityTime")
		if at == "" {
			at = "19:00"
		}
		for _, v := range rows(s, "reservations") {
			b := object(v)
			if str(b, "facilityId") == fid && str(b, "status") == "confirmed" && str(b, "date") == day && str(b, "start") <= at && str(b, "end") > at {
				available -= groupCost(f, b)
			}
		}
		for _, u := range liveUsage(s, fid) {
			available -= groupCost(f, u)
		}
		for _, q := range queueRows(s, fid) {
			cost := groupCost(f, q)
			if cost > available {
				break
			}
			available -= cost
			if str(q, "status") == "waiting" {
				q["status"] = "ready"
				q["readyUntil"] = time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)
			}
		}
	}
}

type Actor struct {
	Role       string `json:"role"`
	ResidentID string `json:"residentId"`
	Name       string `json:"name"`
	Permission string `json:"permission,omitempty"`
	StaffID    string `json:"staffId,omitempty"`
}

func projectGo(s obj, actor Actor) obj {
	if actor.Role == "operator" {
		if !actor.admin() {
			return projectStaffGo(s, actor)
		}
		return projectAccessGo(s, clone(s), actor)
	}
	c := clone(s)
	r := find(s, "residents", actor.ResidentID)
	for _, k := range []string{"residents", "contracts", "invoices", "tickets", "reservations", "queueEntries", "facilityUsage", "accessEvents"} {
		a := []any{}
		for _, v := range rows(c, k) {
			item := object(v)
			match := str(item, "residentId") == actor.ResidentID
			if k == "residents" {
				match = str(item, "id") == actor.ResidentID
			}
			if match {
				a = append(a, item)
			}
		}
		c[k] = a
	}
	room := []any{}
	for _, v := range rows(c, "rooms") {
		if str(object(v), "number") == str(r, "room") {
			room = append(room, v)
		}
	}
	c["rooms"] = room
	assets := []any{}
	for _, v := range rows(c, "assets") {
		location := str(object(v), "location")
		if (!strings.HasPrefix(location, "A-") && !strings.HasPrefix(location, "B-")) || strings.HasPrefix(location, str(r, "room")+" ") {
			assets = append(assets, v)
		}
	}
	c["assets"] = assets
	mail := []any{}
	for _, v := range rows(c, "mail") {
		if str(object(v), "to") == str(r, "email") {
			mail = append(mail, v)
		}
	}
	c["mail"] = mail
	availability := []any{}
	for _, v := range rows(s, "reservations") {
		b := object(v)
		if str(b, "status") == "confirmed" || str(b, "status") == "active" {
			availability = append(availability, obj{"facilityId": b["facilityId"], "date": b["date"], "start": b["start"], "end": b["end"], "attendees": b["attendees"], "own": str(b, "residentId") == actor.ResidentID})
		}
	}
	c["availability"] = availability
	summary, qs := []any{}, []any{}
	for _, v := range rows(s, "facilities") {
		f := object(v)
		used := 0.0
		for _, u := range liveUsage(s, str(f, "id")) {
			used += groupCost(f, u)
		}
		summary = append(summary, obj{"facilityId": f["id"], "used": used})
		qs = append(qs, obj{"facilityId": f["id"], "count": len(queueRows(s, str(f, "id")))})
	}
	c["usageSummary"] = summary
	c["queueSummary"] = qs
	for _, v := range rows(c, "queueEntries") {
		q := object(v)
		q["position"] = float64(0)
		for i, other := range queueRows(s, str(q, "facilityId")) {
			if str(q, "id") == str(other, "id") {
				q["position"] = float64(i + 1)
			}
		}
	}
	return projectAccessGo(s, c, actor)
}
func mergeResidentGo(current, proposal obj, actor Actor) (obj, error) {
	s := clone(current)
	view := projectGo(current, actor)
	rid := actor.ResidentID
	r := find(s, "residents", rid)
	denied := errors.New("this change requires operator access")
	for _, key := range []string{"settings", "residents", "plans", "invoices", "rooms", "facilities", "reservations", "queueEntries", "facilityUsage", "mail"} {
		if !reflect.DeepEqual(view[key], proposal[key]) {
			return nil, denied
		}
	}
	for _, v := range rows(proposal, "contracts") {
		c := object(v)
		old := find(s, "contracts", str(c, "id"))
		if old == nil || str(old, "residentId") != rid {
			return nil, denied
		}
		allowed := clone(old)
		if str(old, "status") != "signed" && str(c, "status") == "signed" {
			allowed["status"] = "signed"
			allowed["signedName"] = r["name"]
			allowed["signedAt"] = c["signedAt"]
		}
		if !reflect.DeepEqual(allowed, c) {
			return nil, denied
		}
		for k, val := range allowed {
			old[k] = val
		}
	}
	for _, v := range rows(proposal, "tickets") {
		t := object(v)
		old := find(s, "tickets", str(t, "id"))
		if old != nil {
			if str(old, "residentId") != rid || !reflect.DeepEqual(old, t) {
				return nil, denied
			}
		} else {
			if str(t, "residentId") != rid || str(t, "status") != "open" {
				return nil, denied
			}
			appendRow(s, "tickets", t)
			a := find(s, "assets", str(t, "assetId"))
			if a != nil {
				a["status"] = "repair"
			}
		}
	}
	for _, v := range rows(proposal, "posts") {
		p := object(v)
		old := find(s, "posts", str(p, "id"))
		if old == nil {
			if str(p, "author") != str(r, "name") || str(p, "role") != "resident" || str(p, "type") == "announcement" {
				return nil, denied
			}
			s["posts"] = append([]any{p}, rows(s, "posts")...)
			continue
		}
		candidate := clone(old)
		candidate["likes"] = p["likes"]
		candidate["comments"] = p["comments"]
		if !reflect.DeepEqual(candidate, p) {
			return nil, denied
		}
		comments := rows(p, "comments")
		oldComments := rows(old, "comments")
		if len(comments) < len(oldComments) {
			return nil, denied
		}
		for i, c := range oldComments {
			if !reflect.DeepEqual(c, comments[i]) {
				return nil, denied
			}
		}
		for _, c := range comments[len(oldComments):] {
			if str(object(c), "author") != str(r, "name") {
				return nil, denied
			}
		}
		others := func(list []any) []any {
			a := []any{}
			for _, v := range list {
				if v != rid {
					a = append(a, v)
				}
			}
			return a
		}
		if !reflect.DeepEqual(others(rows(old, "likes")), others(rows(p, "likes"))) {
			return nil, denied
		}
		old["likes"] = p["likes"]
		old["comments"] = p["comments"]
	}
	for _, v := range rows(proposal, "messages") {
		m := object(v)
		old := find(s, "messages", str(m, "id"))
		if old != nil {
			if !reflect.DeepEqual(old, m) {
				return nil, denied
			}
		} else {
			if str(m, "author") != str(r, "name") || str(m, "role") != "resident" {
				return nil, denied
			}
			appendRow(s, "messages", m)
		}
	}
	return s, nil
}
func facilityActionGo(original obj, actor Actor, cmd obj) (obj, error) {
	s := clone(original)
	reconcileGo(s)
	f := find(s, "facilities", str(cmd, "facilityId"))
	if f == nil {
		return nil, errors.New("facility not found")
	}
	fid := str(f, "id")
	action := str(cmd, "action")
	rid := actor.ResidentID
	if actor.Role == "operator" {
		rid = str(cmd, "residentId")
	}
	denied := errors.New("access denied")
	switch action {
	case "release":
		u := find(s, "facilityUsage", str(cmd, "usageId"))
		if u == nil || str(u, "facilityId") != fid || (actor.Role != "operator" && str(u, "residentId") != rid) {
			return nil, denied
		}
		u["status"] = "released"
		u["releasedAt"] = stamp()
		if b := find(s, "reservations", str(u, "reservationId")); b != nil {
			b["status"] = "completed"
		}
	case "queue-cancel":
		q := find(s, "queueEntries", str(cmd, "queueId"))
		if q == nil || (actor.Role != "operator" && str(q, "residentId") != rid) {
			return nil, denied
		}
		q["status"] = "cancelled"
	case "cancel-booking":
		b := find(s, "reservations", str(cmd, "bookingId"))
		if b == nil || (actor.Role != "operator" && str(b, "residentId") != rid) {
			return nil, denied
		}
		if str(b, "status") == "active" {
			return nil, errors.New("end the active session first")
		}
		b["status"] = "cancelled"
	case "advance":
		if actor.Role != "operator" {
			return nil, denied
		}
	default:
		if find(s, "residents", rid) == nil {
			return nil, errors.New("resident not found")
		}
		if f["enabled"] == false {
			return nil, errors.New("this facility is unavailable")
		}
		count := number(cmd, "attendees")
		if count == 0 {
			count = 1
		}
		if count < 1 || count > number(f, "capacity") {
			return nil, errors.New("invalid group size")
		}
		switch action {
		case "book":
			day, start, end := str(cmd, "date"), str(cmd, "start"), str(cmd, "end")
			_, de := time.Parse("2006-01-02", day)
			_, se := time.Parse("15:04", start)
			_, ee := time.Parse("15:04", end)
			hours := strings.Split(strings.ReplaceAll(str(f, "hours"), "–", "-"), "-")
			if de != nil || se != nil || ee != nil || start >= end || len(hours) != 2 || start < hours[0] || end > hours[1] {
				return nil, errors.New("invalid booking time")
			}
			appendRow(s, "reservations", obj{"id": freshID("booking"), "residentId": rid, "facilityId": fid, "date": day, "start": start, "end": end, "attendees": count, "status": "confirmed", "createdAt": stamp()})
		case "queue":
			for _, u := range liveUsage(s, fid) {
				if str(u, "residentId") == rid {
					return nil, errors.New("you already have an active session")
				}
			}
			for _, q := range queueRows(s, fid) {
				if str(q, "residentId") == rid {
					return nil, errors.New("you are already in the queue")
				}
			}
			appendRow(s, "queueEntries", obj{"id": freshID("queue"), "facilityId": fid, "residentId": rid, "attendees": count, "status": "waiting", "sequence": float64(len(rows(s, "queueEntries")) + 1), "createdAt": stamp()})
		case "activate":
			loc, _ := time.LoadLocation("Europe/London")
			day := time.Now().In(loc).Format("2006-01-02")
			at := str(object(s["settings"]), "facilityTime")
			if at == "" {
				at = "19:00"
			}
			hours := strings.Split(strings.ReplaceAll(str(f, "hours"), "–", "-"), "-")
			if len(hours) != 2 || at < hours[0] || at >= hours[1] {
				return nil, errors.New("this facility is closed")
			}
			var booking obj
			reserved := 0.0
			for _, v := range rows(s, "reservations") {
				b := object(v)
				if str(b, "facilityId") == fid && str(b, "date") == day && str(b, "status") == "confirmed" && str(b, "start") <= at && str(b, "end") > at {
					if str(b, "residentId") == rid {
						booking = b
					} else {
						reserved += groupCost(f, b)
					}
				}
			}
			q := queueRows(s, fid)
			if len(q) > 0 && str(q[0], "residentId") != rid && booking == nil {
				return nil, errors.New("please wait for your turn")
			}
			active := 0.0
			for _, u := range liveUsage(s, fid) {
				if str(u, "residentId") == rid {
					return nil, errors.New("you already have an active session")
				}
				active += groupCost(f, u)
			}
			if booking != nil {
				count = number(booking, "attendees")
			}
			if active+reserved+groupCost(f, obj{"attendees": count}) > number(f, "capacity") {
				return nil, errors.New("this facility is full; join the queue")
			}
			uid := freshID("use")
			bid := ""
			if booking != nil {
				booking["status"] = "active"
				bid = str(booking, "id")
			}
			u := obj{"id": uid, "residentId": rid, "facilityId": fid, "attendees": count, "status": "active", "startedAt": stamp(), "expiresAt": time.Now().Add(time.Duration(number(f, "activationMinutes")) * time.Minute).UTC().Format(time.RFC3339Nano), "accessCode": strings.ToUpper(freshID("")[1:9]), "reservationId": bid}
			appendRow(s, "facilityUsage", u)
			for _, q := range queueRows(s, fid) {
				if str(q, "residentId") == rid {
					q["status"] = "served"
				}
			}
			appendRow(s, "accessEvents", obj{"id": freshID("access"), "residentId": rid, "facilityId": fid, "usageId": uid, "method": "qr-demo", "createdAt": stamp()})
		default:
			return nil, errors.New("unknown action")
		}
	}
	reconcileGo(s)
	if err := validateV2(s); err != nil {
		return nil, err
	}
	return s, nil
}

type portalSession struct {
	OperatorKey string
	Actor       Actor
	Expires     time.Time
}
type Portal struct {
	Store    *Store
	mu       sync.Mutex
	sessions map[string]portalSession
}

func (p *Portal) snapshot() (Envelope, obj) {
	p.Store.mu.Lock()
	defer p.Store.mu.Unlock()
	var s obj
	json.Unmarshal(p.Store.state.Data, &s)
	return p.Store.state, s
}
func (p *Portal) actor(r *http.Request, role string, state obj) (Actor, bool) {
	cookie, err := r.Cookie("haven_" + role)
	if err != nil {
		return Actor{}, false
	}
	p.mu.Lock()
	s, ok := p.sessions[cookie.Value]
	p.mu.Unlock()
	if !ok || s.Actor.Role != role || !s.Expires.After(time.Now()) {
		return Actor{}, false
	}
	if role == "resident" {
		return s.Actor, true
	}
	for _, value := range operatorAccountsGo(state) {
		a := object(value)
		if a["enabled"] == true && operatorKeyGo(a) == s.OperatorKey {
			return operatorActorGo(a), true
		}
	}
	return Actor{}, false
}
func (p *Portal) handler(role, part string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			origin := r.Header.Get("Origin")
			if origin != "" && origin != "http://"+r.Host && origin != "https://"+r.Host {
				reply(w, 403, obj{"error": "origin not allowed"})
				return
			}
		}
		if part == "session" {
			if r.Method == "POST" {
				var login obj
				if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&login) != nil {
					reply(w, 401, obj{"error": "invalid demo access code"})
					return
				}
				_, s := p.snapshot()
				a := Actor{Role: role}
				operatorKey := ""
				if role == "operator" {
					account := loginOperatorGo(s, str(login, "email"), str(login, "code"))
					if account == nil {
						reply(w, 401, obj{"error": "Invalid email or access code"})
						return
					}
					a, operatorKey = operatorActorGo(account), operatorKeyGo(account)
				} else {
					if str(login, "code") != "resident-demo" {
						reply(w, 401, obj{"error": "invalid demo access code"})
						return
					}
					for _, v := range rows(s, "residents") {
						res := object(v)
						if str(res, "email") == str(login, "email") {
							a.ResidentID = str(res, "id")
							a.Name = str(res, "name")
						}
					}
					if a.ResidentID == "" {
						reply(w, 401, obj{"error": "unknown resident account"})
						return
					}
				}
				token := freshID("session")
				p.mu.Lock()
				p.sessions[token] = portalSession{OperatorKey: operatorKey, Actor: a, Expires: time.Now().Add(12 * time.Hour)}
				p.mu.Unlock()
				http.SetCookie(w, &http.Cookie{Name: "haven_" + role, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 43200})
				reply(w, 200, a)
				return
			}
			if r.Method == "DELETE" {
				if c, e := r.Cookie("haven_" + role); e == nil {
					p.mu.Lock()
					delete(p.sessions, c.Value)
					p.mu.Unlock()
				}
				http.SetCookie(w, &http.Cookie{Name: "haven_" + role, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
				reply(w, 200, obj{"ok": true})
				return
			}
			_, state := p.snapshot()
			a, ok := p.actor(r, role, state)
			if !ok {
				reply(w, 401, obj{"error": "please sign in"})
				return
			}
			reply(w, 200, a)
			return
		}
		current, s := p.snapshot()
		a, ok := p.actor(r, role, s)
		if !ok {
			reply(w, 401, obj{"error": "please sign in"})
			return
		}
		if part == "state" && r.Method == "GET" {
			reply(w, 200, obj{"revision": current.Revision, "data": projectGo(s, a)})
			return
		}
		if (part == "state" && r.Method != "PUT") || (part == "action" && r.Method != "POST") {
			reply(w, 405, obj{"error": "method not allowed"})
			return
		}
		if part == "state" && role == "operator" && !a.admin() {
			reply(w, 403, obj{"error": "Access denied"})
			return
		}
		var body struct {
			Revision int64 `json:"revision"`
			Data     obj   `json:"data"`
			Command  obj   `json:"command"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1500000)).Decode(&body) != nil {
			reply(w, 400, obj{"error": "invalid JSON"})
			return
		}
		if body.Revision != current.Revision {
			reply(w, 409, obj{"error": "another page updated this record; refresh and try again"})
			return
		}
		next := body.Data
		var err error
		var code string
		if part == "action" {
			next, code, err = portalActionGo(s, a, body.Command)
		} else if role == "resident" {
			next, err = mergeResidentGo(s, body.Data, a)
		} else if next != nil {
			next = preserveAccessGo(s, next)
		}
		if err != nil {
			status := 422
			if errors.Is(err, errAccessDenied) {
				status = 403
			}
			reply(w, status, obj{"error": err.Error()})
			return
		}
		data, _ := json.Marshal(next)
		p.Store.save(w, Envelope{Revision: current.Revision, Data: data}, code)
	}
}
func registerPortal(mux *http.ServeMux, store *Store) {
	p := &Portal{Store: store, sessions: map[string]portalSession{}}
	for _, role := range []string{"operator", "resident"} {
		for _, part := range []string{"state", "session", "action"} {
			mux.HandleFunc("/api/"+role+"/"+part, p.handler(role, part))
		}
	}
	mux.HandleFunc("/api/demo-accounts", func(w http.ResponseWriter, r *http.Request) {
		_, s := p.snapshot()
		accounts := []any{}
		for _, v := range rows(s, "residents") {
			a := object(v)
			accounts = append(accounts, obj{"id": a["id"], "name": a["name"], "room": a["room"], "email": a["email"]})
		}
		reply(w, 200, obj{"operator": obj{"email": "alex.morgan@example.com", "name": "Alex Morgan"}, "operators": demoOperatorsGo(s), "residents": accounts})
	})
}
