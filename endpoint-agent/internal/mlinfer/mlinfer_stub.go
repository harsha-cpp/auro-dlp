package mlinfer

import "strings"

var piiKeywords = []string{
	"patient", "diagnosis", "prescription", "medical record", "discharge",
	"admitted", "treatment", "lab report", "x-ray", "mri", "biopsy",
	"रोगी", "निदान", "दवा", "उपचार", "आधार", "पैन",
	"aadhaar", "pan card", "passport", "social security",
}

type StubScorer struct{}

func NewStubScorer() *StubScorer { return &StubScorer{} }

func (s *StubScorer) Score(text string) (float64, []string, error) {
	if len(text) == 0 {
		return 0, nil, nil
	}
	lower := strings.ToLower(text)
	hits := 0
	var matched []string
	for _, kw := range piiKeywords {
		if strings.Contains(lower, kw) {
			hits++
			matched = append(matched, kw)
			if hits >= 10 {
				break
			}
		}
	}
	score := float64(hits) / 5.0
	if score > 1.0 {
		score = 1.0
	}
	return score, matched, nil
}
