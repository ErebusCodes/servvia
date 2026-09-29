package contract

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"servvia/services/core-platform/tests/testsupport"
)

// Every schema published in contracts/ compiles as JSON Schema 2020-12, not
// only the ones a test happens to validate against.
func TestEveryContractSchemaCompiles(t *testing.T) {
	root := testsupport.ContractPath("")
	compiled := 0
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		switch {
		case strings.HasSuffix(rel, ".schema.json"):
			testsupport.Schema(t, rel, "")
			compiled++
		case strings.HasPrefix(rel, "openapi/") && strings.HasSuffix(rel, ".yaml"):
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var doc struct {
				Components struct {
					Schemas map[string]any `yaml:"schemas"`
				} `yaml:"components"`
			}
			if err := yaml.Unmarshal(raw, &doc); err != nil {
				t.Errorf("%s: %v", rel, err)
				return nil
			}
			names := make([]string, 0, len(doc.Components.Schemas))
			for name := range doc.Components.Schemas {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				testsupport.Schema(t, rel, "/components/schemas/"+name)
				compiled++
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if compiled < 20 {
		t.Errorf("only %d schemas compiled; is contracts/ where it should be?", compiled)
	}
	t.Logf("%d schemas compiled", compiled)
}
