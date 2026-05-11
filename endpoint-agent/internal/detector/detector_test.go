package detector

import (
	"strings"
	"testing"
)

func TestAadhaarVerhoeff(t *testing.T) {
	// Known good Aadhaar test number (passes Verhoeff)
	// Source: UIDAI public test vectors.
	good := "234123412346"
	if !ValidateAadhaar(good) {
		t.Fatalf("expected %s to validate", good)
	}
	bad := "234123412345"
	if ValidateAadhaar(bad) {
		t.Fatalf("expected %s to fail", bad)
	}
}

func TestPAN(t *testing.T) {
	cases := map[string]bool{
		"ABCPE1234F": true,  // 4th = P (individual)
		"ABCFE1234F": true,  // 4th = F (firm)
		"ABCDE1234F": false, // 4th = D, not in PFCHATBLJG
		"AB1PE1234F": false, // non-letter in name block
		"ABCPE12345": false, // missing trailing letter
		"ABCXE1234F": false, // 4th = X, not in valid set
	}
	for in, want := range cases {
		if got := ValidatePAN(in); got != want {
			t.Errorf("PAN %s: got %v want %v", in, got, want)
		}
	}
}

func TestLuhn(t *testing.T) {
	cases := map[string]bool{
		"4539578763621486": true,  // Luhn-valid Visa test
		"4539578763621487": false, // off by one
		"4111 1111 1111 1111": true,
	}
	for in, want := range cases {
		if got := ValidateLuhn(in); got != want {
			t.Errorf("Luhn %q: got %v want %v", in, got, want)
		}
	}
}

func TestInspectMRNAndAadhaar(t *testing.T) {
	d, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	body := "Hi Dr. Suresh, please find lab report for MRN: AC0099321 with HbA1c 8.9.\n" +
		"Patient Aadhaar: 234123412346, mobile 9876543210. Provisional Diagnosis: Type-2 DM."
	r := d.InspectText(body)

	gotIDs := map[string]int{}
	for _, m := range r.Matches {
		gotIDs[m.RuleID] = m.Count
	}
	for _, must := range []string{"PHI.MRN", "IN.AADHAAR", "MED.LAB", "MED.DIAG"} {
		if gotIDs[must] == 0 {
			t.Errorf("expected rule %s to fire; got %v", must, gotIDs)
		}
	}
	if r.Risk < 0.6 {
		t.Errorf("expected high risk; got %.2f", r.Risk)
	}
	if !contains(r.Categories, "PHI") || !contains(r.Categories, "PII-IN") {
		t.Errorf("expected PHI + PII-IN categories; got %v", r.Categories)
	}
}

func TestInspectClean(t *testing.T) {
	d, _ := New("")
	r := d.InspectText("Hello team, the cafeteria menu has been updated for next week. Thanks!")
	if r.Risk > 0.3 {
		t.Errorf("expected low risk; got %.2f matches=%v", r.Risk, r.Matches)
	}
}

func TestPanInBody(t *testing.T) {
	d, _ := New("")
	r := d.InspectText("Please collect from accounts. PAN: ABCPE1234F. Thanks.")
	if !any(r.Matches, func(m Match) bool { return m.RuleID == "IN.PAN" }) {
		t.Errorf("PAN not detected; got %v", r.Matches)
	}
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

func any(ms []Match, p func(Match) bool) bool {
	for _, m := range ms {
		if p(m) {
			return true
		}
	}
	return false
}

func TestNoFalseAadhaarFromPhone(t *testing.T) {
	d, _ := New("")
	// 12-digit phone-like sequence that is *not* Verhoeff-valid
	r := d.InspectText("Reach me at +91 99887 76655 anytime")
	for _, m := range r.Matches {
		if m.RuleID == "IN.AADHAAR" {
			t.Errorf("phone should not match Aadhaar; got %v", m)
		}
	}
}

// quick smoke: weights produce monotonic risk
func TestRiskMonotonic(t *testing.T) {
	d, _ := New("")
	a := d.InspectText("MRN: AB123456")
	b := d.InspectText("MRN: AB123456 Aadhaar 234123412346 ICD: E11.9 dx: T2DM")
	if !(b.Risk >= a.Risk) {
		t.Errorf("risk should increase with more hits: a=%.2f b=%.2f", a.Risk, b.Risk)
	}
	if !strings.Contains(strings.Join(d.dict, " "), "OPD") {
		t.Errorf("default dictionary missing OPD")
	}
}
