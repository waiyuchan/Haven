package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed legacy-copy.json
var legacyCopyJSON []byte

func englishCopy(v any, copyByText map[string]string) any {
	switch value := v.(type) {
	case string:
		if replacement, ok := copyByText[value]; ok {
			return replacement
		}
	case []any:
		for i, item := range value {
			value[i] = englishCopy(item, copyByText)
		}
	case map[string]any:
		for key, item := range value {
			value[key] = englishCopy(item, copyByText)
		}
	}
	return v
}

func migrateEnglishGo(s obj) obj {
	if number(s, "schemaVersion") >= 4 {
		return s
	}
	copyByText := map[string]string{}
	if err := json.Unmarshal(legacyCopyJSON, &copyByText); err != nil {
		panic(err)
	}
	for _, key := range []string{"plans", "contracts", "tickets", "assets", "facilities", "posts", "messages", "doorEvents"} {
		englishCopy(s[key], copyByText)
	}
	for _, value := range rows(s, "facilities") {
		facility := object(value)
		if description := str(facility, "descriptionEn"); description != "" {
			facility["description"] = description
		}
		delete(facility, "descriptionEn")
		delete(facility, "label")
	}
	for _, value := range rows(s, "doorEvents") {
		delete(object(value), "label")
	}
	s["schemaVersion"] = float64(4)
	return s
}
