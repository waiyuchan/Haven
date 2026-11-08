package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const accessSchemaVersion = 3
const doorHistoryLimit = 500

var errAccessDenied = errors.New("Access denied")
var staffEmail = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func migrateAccessGo(s obj) obj {
	if number(s, "schemaVersion") < accessSchemaVersion {
		s["staff"] = []any{obj{
			"id": "demo-staff", "name": "Jamie Taylor", "email": "jamie.taylor@example.com",
			"permission": "staff", "enabled": true, "version": float64(1), "codeHash": "",
		}}
		s["doorUnlocks"] = obj{}
		s["doorEvents"] = []any{}
		s["schemaVersion"] = float64(accessSchemaVersion)
	}
	return s
}

func operatorAccountsGo(s obj) []any {
	admin := obj{"id": "admin", "name": "Alex Morgan", "email": "alex.morgan@example.com", "permission": "admin", "enabled": true}
	return append([]any{admin}, rows(s, "staff")...)
}

func publicStaffGo(a obj) obj {
	return obj{"id": a["id"], "name": a["name"], "email": a["email"], "permission": a["permission"], "enabled": a["enabled"]}
}

func demoOperatorsGo(s obj) []any {
	list := []any{}
	for _, value := range operatorAccountsGo(s) {
		a := object(value)
		if str(a, "id") == "admin" || (str(a, "id") == "demo-staff" && a["enabled"] == true && str(a, "codeHash") == "") {
			list = append(list, publicStaffGo(a))
		}
	}
	return list
}

func operatorKeyGo(a obj) string {
	if str(a, "id") == "admin" {
		return ""
	}
	return str(a, "id") + ":" + strconv.Itoa(int(number(a, "version")))
}

func operatorActorGo(a obj) Actor {
	return Actor{Role: "operator", Name: str(a, "name"), StaffID: str(a, "id"), Permission: str(a, "permission")}
}

func accessHash(code string) string {
	digest := sha256.Sum256([]byte(code))
	return hex.EncodeToString(digest[:])
}

func loginOperatorGo(s obj, email, code string) obj {
	if len(code) > 128 {
		return nil
	}
	for _, value := range operatorAccountsGo(s) {
		a := object(value)
		if a["enabled"] != true || str(a, "email") != strings.ToLower(strings.TrimSpace(email)) {
			continue
		}
		hash := str(a, "codeHash")
		if (str(a, "id") == "admin" && code == "operator-demo") ||
			(str(a, "id") == "demo-staff" && hash == "" && code == "staff-demo") ||
			(hash != "" && subtle.ConstantTimeCompare([]byte(hash), []byte(accessHash(code))) == 1) {
			return a
		}
	}
	return nil
}

func (a Actor) admin() bool { return a.Role == "operator" && a.Permission == "admin" }

func canActionGo(a Actor, action string) bool {
	if a.Role == "resident" {
		switch action {
		case "staff-save", "ticket-progress", "demo-reset", "advance":
			return false
		}
		return true
	}
	if a.admin() {
		return action != "door-access"
	}
	switch action {
	case "ticket-progress", "advance", "release", "queue-cancel", "cancel-booking":
		return true
	}
	return false
}

func allDoorsGo(s obj) []any {
	doors := []any{obj{"id": "entrance", "kind": "entrance"}}
	registered := map[string]bool{}
	for _, value := range rows(s, "rooms") {
		r := object(value)
		registered[str(r, "number")] = true
		doors = append(doors, obj{"id": "room:" + str(r, "id"), "kind": "room", "room": r["number"]})
	}
	for _, value := range rows(s, "residents") {
		room := str(object(value), "room")
		if room != "" && !registered[room] {
			doors = append(doors, obj{"id": "assigned-room:" + room, "kind": "room", "room": room})
			registered[room] = true
		}
	}
	for _, value := range rows(s, "facilities") {
		f := object(value)
		if str(f, "resourceType") == "space" {
			doors = append(doors, obj{"id": "facility:" + str(f, "id"), "kind": "facility", "facilityId": f["id"], "name": f["name"]})
		}
	}
	return doors
}

func mayEnterGo(s, resident, door obj) bool {
	if str(resident, "status") != "in-house" {
		return false
	}
	switch str(door, "kind") {
	case "entrance":
		return true
	case "room":
		return str(resident, "room") == str(door, "room")
	}
	facilityID := str(door, "facilityId")
	if find(s, "facilities", facilityID)["enabled"] != true {
		return false
	}
	for _, u := range liveUsage(s, facilityID) {
		if str(u, "residentId") == str(resident, "id") {
			return true
		}
	}
	return false
}

func lastEntryGo(s obj, residentID, doorID string) bool {
	events := rows(s, "doorEvents")
	for i := len(events) - 1; i >= 0; i-- {
		e := object(events[i])
		if str(e, "residentId") == residentID && str(e, "doorId") == doorID && str(e, "action") != "lock" {
			return str(e, "action") == "entry"
		}
	}
	return false
}

func unlockedUntilGo(s obj, doorID string, now float64) float64 {
	until := number(object(object(s["doorUnlocks"])[doorID]), "until")
	if until <= now {
		return 0
	}
	return until
}

func projectAccessGo(s, view obj, a Actor) obj {
	delete(view, "doorUnlocks")
	delete(view, "staff")
	if a.admin() {
		staff := []any{}
		for _, value := range operatorAccountsGo(s) {
			staff = append(staff, publicStaffGo(object(value)))
		}
		view["staff"] = staff
	}
	resident := find(s, "residents", a.ResidentID)
	now := float64(time.Now().UnixMilli())
	doors := []any{}
	for _, value := range allDoorsGo(s) {
		door := object(value)
		kind, id := str(door, "kind"), str(door, "id")
		if kind == "room" && !a.admin() && (a.Role != "resident" || str(door, "room") != str(resident, "room")) {
			continue
		}
		if a.Role == "resident" {
			entered := kind == "facility" && lastEntryGo(s, a.ResidentID, id)
			if kind == "facility" && find(s, "facilities", str(door, "facilityId"))["enabled"] != true && !entered {
				continue
			}
			enter := mayEnterGo(s, resident, door)
			door["mayEnter"], door["mayExit"] = enter, enter || entered
			door["mayLock"] = unlockedUntilGo(s, id, now) > 0 && str(object(object(s["doorUnlocks"])[id]), "by") == a.ResidentID
		}
		door["unlockedUntil"] = unlockedUntilGo(s, id, now)
		doors = append(doors, door)
	}
	events := []any{}
	for _, value := range rows(s, "doorEvents") {
		e := object(value)
		if a.admin() || (a.Role == "resident" && str(e, "residentId") == a.ResidentID) || (a.Role == "operator" && str(e, "doorKind") != "room") {
			events = append(events, e)
		}
	}
	view["doors"], view["doorEvents"] = doors, events
	return view
}

func projectStaffGo(s obj, a Actor) obj {
	view := obj{}
	for _, key := range []string{"settings", "facilities", "reservations", "queueEntries", "facilityUsage", "tickets"} {
		view[key] = s[key]
	}
	view = clone(view)
	residents, assets := []any{}, []any{}
	for _, value := range rows(s, "residents") {
		r := object(value)
		residents = append(residents, obj{"id": r["id"], "name": r["name"], "room": r["room"], "status": r["status"]})
	}
	linked := map[string]bool{}
	for _, value := range rows(s, "tickets") {
		linked[str(object(value), "assetId")] = true
	}
	for _, value := range rows(s, "assets") {
		asset := object(value)
		if linked[str(asset, "id")] {
			assets = append(assets, obj{"id": asset["id"], "name": asset["name"], "status": asset["status"]})
		}
	}
	for _, value := range rows(view, "facilityUsage") {
		delete(object(value), "accessCode")
	}
	view["residents"], view["assets"] = residents, assets
	return projectAccessGo(s, view, a)
}

func preserveAccessGo(current, next obj) obj {
	for _, key := range []string{"staff", "doorUnlocks", "doorEvents", "accessEvents", "schemaVersion"} {
		next[key] = current[key]
	}
	delete(next, "doors")
	return next
}

func useDoorGo(s obj, a Actor, command obj) error {
	doorID := str(command, "doorId")
	door := find(obj{"doors": allDoorsGo(s)}, "doors", doorID)
	resident := find(s, "residents", a.ResidentID)
	if door == nil || resident == nil {
		return errAccessDenied
	}
	action := str(command, "direction")
	now := time.Now()
	ms := float64(now.UnixMilli())
	unlocks := object(s["doorUnlocks"])
	switch action {
	case "entry", "exit":
		if !mayEnterGo(s, resident, door) && !(action == "exit" && str(door, "kind") == "facility" && lastEntryGo(s, a.ResidentID, doorID)) {
			return errAccessDenied
		}
	case "lock":
		if unlockedUntilGo(s, doorID, ms) == 0 || str(object(unlocks[doorID]), "by") != a.ResidentID {
			return errAccessDenied
		}
	default:
		return errAccessDenied
	}
	for id, value := range unlocks {
		if number(object(value), "until") <= ms {
			delete(unlocks, id)
		}
	}
	if action == "lock" {
		delete(unlocks, doorID)
	} else {
		unlocks[doorID] = obj{"until": float64(now.Add(15 * time.Second).UnixMilli()), "by": a.ResidentID}
	}
	event := obj{"id": freshID("door"), "doorId": doorID, "doorKind": door["kind"], "residentId": a.ResidentID,
		"residentName": resident["name"], "action": action, "createdAt": now.UTC().Format(time.RFC3339Nano)}
	for _, key := range []string{"room", "name"} {
		if door[key] != nil {
			event[key] = door[key]
		}
	}
	appendRow(s, "doorEvents", event)
	if events := rows(s, "doorEvents"); len(events) > doorHistoryLimit {
		s["doorEvents"] = events[len(events)-doorHistoryLimit:]
	}
	return nil
}

func ticketProgressGo(s, command obj) error {
	ticket := find(s, "tickets", str(command, "ticketId"))
	status := str(command, "status")
	if ticket == nil || (status != "open" && status != "in-progress" && status != "resolved") {
		return errors.New("Invalid repair status")
	}
	if asset := find(s, "assets", str(ticket, "assetId")); asset != nil {
		assetStatus := str(command, "assetStatus")
		if assetStatus != "good" && assetStatus != "repair" {
			return errors.New("Invalid asset status")
		}
		asset["status"] = assetStatus
	}
	ticket["status"], ticket["updatedAt"] = status, stamp()
	return nil
}

func saveStaffGo(s, command obj) (string, error) {
	id := str(command, "staffId")
	existing := find(s, "staff", id)
	if id != "" && existing == nil {
		return "", errors.New("Staff account not found")
	}
	name := strings.TrimSpace(str(command, "name"))
	email := strings.ToLower(strings.TrimSpace(str(command, "email")))
	permission := str(command, "permission")
	enabled, ok := command["enabled"].(bool)
	if name == "" || utf8.RuneCountInString(name) > 80 || len(email) > 150 || !staffEmail.MatchString(email) ||
		(permission != "admin" && permission != "staff") || !ok {
		return "", errors.New("Invalid staff details")
	}
	for _, value := range operatorAccountsGo(s) {
		a := object(value)
		if str(a, "id") != id && str(a, "email") == email {
			return "", errors.New("Email already in use")
		}
	}
	if existing == nil && len(rows(s, "staff")) >= 100 {
		return "", errors.New("Staff limit reached")
	}
	code, hash := "", str(existing, "codeHash")
	version := number(existing, "version")
	changedIdentity := str(existing, "email") != email || str(existing, "permission") != permission
	issueCode := existing == nil || command["rotateCode"] == true || (hash == "" && changedIdentity)
	if issueCode {
		code = strings.TrimPrefix(freshID(""), "-") + strings.TrimPrefix(freshID(""), "-")
		hash = accessHash(code)
	}
	if issueCode || changedIdentity || existing["enabled"] != enabled {
		version++
	}
	if existing == nil {
		existing = obj{"id": freshID("staff")}
		appendRow(s, "staff", existing)
	}
	existing["name"], existing["email"], existing["permission"] = name, email, permission
	existing["enabled"], existing["version"], existing["codeHash"] = enabled, version, hash
	return code, nil
}

func portalActionGo(s obj, a Actor, command obj) (obj, string, error) {
	action := str(command, "action")
	if !canActionGo(a, action) {
		return nil, "", errAccessDenied
	}
	next := clone(s)
	switch action {
	case "door-access":
		return next, "", useDoorGo(next, a, command)
	case "ticket-progress":
		return next, "", ticketProgressGo(next, command)
	case "staff-save":
		if str(command, "staffId") != "" && str(command, "staffId") == a.StaffID {
			return nil, "", errAccessDenied
		}
		code, err := saveStaffGo(next, command)
		return next, code, err
	case "demo-reset":
		var seed obj
		json.Unmarshal(seedJSON, &seed)
		return preserveAccessGo(s, migrateGo(seed)), "", nil
	default:
		data, err := facilityActionGo(s, a, command)
		return data, "", err
	}
}
