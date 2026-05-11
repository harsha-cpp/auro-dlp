package detector

import (
	"math"
	"strings"
	"unicode"
)

// mlScore is a deterministic stub for the ML sensitivity classifier. The
// production agent loads an XGBoost JSON model from
// %ProgramData%\AURO-DLP\models\sensitivity.json; the function below is a
// fallback so the binary returns a meaningful value even when the model is
// absent (air-gapped lab builds, first-run before policy fetch).
//
// Features used:
//   - regex_signal       — total weighted regex hits (saturates)
//   - dict_hits          — count of hospital dictionary matches
//   - digit_density      — digits / total chars (PHI-heavy docs trend high)
//   - upper_density      — uppercase ratio (lab reports trend high)
//   - has_diag_marker    — presence of "diagnosis:" / "impression:"
//   - len_log            — log10(text_len)
//
// Coefficients were calibrated against a small synthetic corpus (lab reports,
// discharge summaries, prescription notes vs. casual emails) to produce
// reasonable behaviour out of the box.
func mlScore(text string, regexSignal float64, dictHits int) float64 {
	if text == "" {
		return 0
	}
	digits, uppers := 0, 0
	for _, r := range text {
		if r >= '0' && r <= '9' {
			digits++
		}
		if unicode.IsUpper(r) {
			uppers++
		}
	}
	n := float64(len(text))
	digitDensity := float64(digits) / n
	upperDensity := float64(uppers) / n

	low := strings.ToLower(text)
	hasDiag := 0.0
	for _, m := range []string{"diagnosis:", "impression:", "provisional:", "discharge summary"} {
		if strings.Contains(low, m) {
			hasDiag = 1
			break
		}
	}

	lenLog := math.Log10(n + 1)

	// Logistic regression on engineered features.
	z := -2.4 +
		0.55*math.Tanh(regexSignal/3) +
		0.40*math.Tanh(float64(dictHits)/4) +
		2.20*digitDensity +
		1.10*upperDensity +
		1.30*hasDiag +
		0.05*lenLog

	return 1.0 / (1.0 + math.Exp(-z))
}
