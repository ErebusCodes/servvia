// Package architecture guards the Go Core against the legacy external-POS
// model (ADR 0001). Servvia Core owns the POS; IdealPOS is frozen legacy code
// scheduled for deletion, and none of its concepts may enter the canonical
// Go packages, not even as a column name in a query.
package architecture

import (
	"go/parser"
	"go/scanner"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// forbidden are lower-cased fragments of the legacy model's names. A code
// token (identifier or string literal, so SQL is covered) containing one
// fails the test. Comments may name them, to explain why they are absent.
var forbidden = []string{
	"idealpos",
	"possyncrecord",
	"possyncstatus",
	"posadaptertype",
	"posconfig",
	"posproductidentity",
	"posproductcode",
	"postablecode",
	"nativesendattempt",
	"nativeround",
	"waiterpad",
	"connectorcommand",
	"legacy-external-pos",
	"legacyexternalpos",
	"externalposhandoff",
}

// guarded are the permanent Go Core source trees.
var guarded = []string{"cmd", "internal"}

// mustScan are the canonical domain packages the guard must be seeing; if one
// moves out of a guarded tree, the guard fails instead of silently skipping it.
var mustScan = []string{"internal/pricing", "internal/venues", "internal/tables", "internal/orders", "internal/kitchen", "internal/checks", "internal/payments", "internal/shifts", "internal/devices", "internal/refunds", "internal/promotions", "internal/realtime"}

func TestGoCoreHasNoExternalPOSConcepts(t *testing.T) {
	root := filepath.Join("..", "..")
	files := 0
	seen := map[string]bool{}
	for _, dir := range guarded {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
				return err
			}
			files++
			for _, pkg := range mustScan {
				if strings.HasPrefix(filepath.ToSlash(path), filepath.ToSlash(filepath.Join(root, pkg))+"/") {
					seen[pkg] = true
				}
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for _, v := range violations(path, src) {
				t.Errorf("%s references the legacy external-POS model", v)
			}
			checkImports(t, path, src)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if files < 20 {
		t.Fatalf("scanned only %d files; the guard is not looking at the Go Core", files)
	}
	for _, pkg := range mustScan {
		if !seen[pkg] {
			t.Errorf("the guard scanned nothing in %s", pkg)
		}
	}
}

// violations lists the code tokens of one file that name a legacy concept.
func violations(path string, src []byte) []string {
	fset := token.NewFileSet()
	file := fset.AddFile(path, fset.Base(), len(src))
	var s scanner.Scanner
	s.Init(file, src, nil, 0) // mode 0: comments are skipped
	var found []string
	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			return found
		}
		if tok != token.IDENT && tok != token.STRING {
			continue
		}
		lower := strings.ToLower(lit)
		for _, f := range forbidden {
			if strings.Contains(lower, f) {
				found = append(found, fset.Position(pos).String()+": "+lit+" ("+f+")")
			}
		}
	}
}

func checkImports(t *testing.T, path string, src []byte) {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, src, parser.ImportsOnly)
	if err != nil {
		t.Errorf("%s: %v", path, err)
		return
	}
	for _, imp := range f.Imports {
		p := strings.ToLower(strings.Trim(imp.Path.Value, `"`))
		for _, bad := range []string{"idealpos", "pos-sync", "possync", "connector", "legacy"} {
			if strings.Contains(p, bad) {
				t.Errorf("%s imports %s", path, p)
			}
		}
		// Phase D12: WebSocket code lives only in the realtime transport.
		// Domain packages record facts; they never talk to subscribers.
		if strings.HasPrefix(p, "github.com/coder/websocket") && !strings.Contains(filepath.ToSlash(path), "internal/realtime/realtimeapi/") {
			t.Errorf("%s imports %s outside internal/realtime/realtimeapi", path, p)
		}
	}
}

// The guard must actually catch what it claims to.
func TestGuardDetectsViolations(t *testing.T) {
	for _, src := range []string{
		"package x\nvar q = `SELECT \"posAdapterType\" FROM \"Venue\"`\n",
		"package x\ntype IdealposClient struct{}\n",
		"package x\nfunc f(r POSSyncRecord) {}\n",
	} {
		if len(violations("probe.go", []byte(src))) == 0 {
			t.Errorf("guard missed a violation in %q", src)
		}
	}
	if v := violations("ok.go", []byte("package x\n// posAdapterType is deliberately not selected.\nvar q = 1\n")); len(v) != 0 {
		t.Errorf("comments must not count as violations: %v", v)
	}
}
