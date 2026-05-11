// Package detector implements the hybrid PHI/PII detection pipeline:
// regex catalogue (with post-validators) + dictionary signal + lightweight ML
// scorer. All rules are configurable via a YAML pattern file the policy server
// signs and pushes; this package keeps the deterministic, dependency-free
// portion of the engine that ships in every binary as the floor.
package detector

import (
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// Match is a single rule-hit summary. Per privacy design, we never include the
// raw matched substring in upstream messages — only counts and offsets.
type Match struct {
	RuleID      string `json:"rule_id"`
	Category    string `json:"category"`
	Count       int    `json:"count"`
	FirstOffset int    `json:"first_offset"`
}

// Result is what InspectText returns. Risk is a 0..1 composite.
type Result struct {
	Matches        []Match            `json:"matches"`
	Categories     []string           `json:"categories"`
	DictionaryHits int                `json:"dictionary_hits"`
	MLSignal       float64            `json:"ml_signal"`
	Risk           float64            `json:"risk"`
	Stats          map[string]float64 `json:"stats,omitempty"`
}

// Rule is a compiled pattern with optional post-validator.
type Rule struct {
	ID        string         `yaml:"id"`
	Category  string         `yaml:"category"`
	Pattern   string         `yaml:"pattern"`
	Weight    float64        `yaml:"weight"`
	Validator string         `yaml:"validator"`
	re        *regexp.Regexp `yaml:"-"`
	validate  func(string) bool
}

type ruleFile struct {
	Rules        []*Rule  `yaml:"rules"`
	Dictionaries []string `yaml:"dictionaries"`
}

// Detector is safe for concurrent use.
type Detector struct {
	mu     sync.RWMutex
	rules  []*Rule
	dict   []string
	dictRE *regexp.Regexp
}

// New loads patterns from `path`. If path is empty or missing, the built-in
// default catalogue is used. The default ships every binary so the agent is
// useful immediately, with the YAML file able to extend or override it.
func New(path string) (*Detector, error) {
	d := &Detector{}
	if err := d.loadDefaults(); err != nil {
		return nil, err
	}
	if path != "" {
		if err := d.loadFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return d, nil
}

func (d *Detector) loadDefaults() error {
	for _, r := range defaultRules() {
		if err := d.addRule(r); err != nil {
			return err
		}
	}
	d.setDictionary(defaultDictionary())
	return nil
}

func (d *Detector) loadFile(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var f ruleFile
	if err := yaml.Unmarshal(b, &f); err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, r := range f.Rules {
		if err := d.addRuleLocked(r); err != nil {
			return err
		}
	}
	if len(f.Dictionaries) > 0 {
		d.setDictionaryLocked(f.Dictionaries)
	}
	return nil
}

func (d *Detector) addRule(r *Rule) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.addRuleLocked(r)
}

func (d *Detector) addRuleLocked(r *Rule) error {
	re, err := regexp.Compile(r.Pattern)
	if err != nil {
		return err
	}
	r.re = re
	r.validate = validators[r.Validator]
	if r.Weight == 0 {
		r.Weight = 1.0
	}
	// Replace if same ID exists, else append.
	for i, ex := range d.rules {
		if ex.ID == r.ID {
			d.rules[i] = r
			return nil
		}
	}
	d.rules = append(d.rules, r)
	return nil
}

func (d *Detector) setDictionary(words []string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.setDictionaryLocked(words)
}

func (d *Detector) setDictionaryLocked(words []string) {
	d.dict = words
	if len(words) == 0 {
		d.dictRE = nil
		return
	}
	parts := make([]string, 0, len(words))
	for _, w := range words {
		parts = append(parts, regexp.QuoteMeta(w))
	}
	d.dictRE = regexp.MustCompile(`(?i)\b(?:` + strings.Join(parts, "|") + `)\b`)
}

// InspectText is the primary entry point. It is allocation-conscious for hot
// paths (Gmail send interception runs this on every click).
func (d *Detector) InspectText(text string) Result {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if text == "" {
		return Result{Matches: []Match{}, Categories: []string{}}
	}

	// 1. Regex pass with post-validators.
	matches := make([]Match, 0, 4)
	cats := map[string]struct{}{}
	regexSignal := 0.0
	for _, r := range d.rules {
		idx := r.re.FindAllStringIndex(text, -1)
		if len(idx) == 0 {
			continue
		}
		valid := 0
		first := -1
		for _, p := range idx {
			s := text[p[0]:p[1]]
			if r.validate != nil && !r.validate(s) {
				continue
			}
			valid++
			if first == -1 {
				first = p[0]
			}
		}
		if valid == 0 {
			continue
		}
		matches = append(matches, Match{
			RuleID:      r.ID,
			Category:    r.Category,
			Count:       valid,
			FirstOffset: first,
		})
		cats[r.Category] = struct{}{}
		regexSignal += r.Weight * float64(valid)
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].FirstOffset < matches[j].FirstOffset })

	// 2. Dictionary signal.
	dictHits := 0
	if d.dictRE != nil {
		dictHits = len(d.dictRE.FindAllString(text, -1))
	}

	// 3. Lightweight ML signal — placeholder logistic on engineered features.
	ml := mlScore(text, regexSignal, dictHits)

	// Saturating sum to [0,1].
	regexNorm := saturate(regexSignal / 6.0) // ~6 weighted hits = full signal
	dictNorm := saturate(float64(dictHits) / 8.0)
	context := dictNorm * 0.20

	risk := 0.50*regexNorm + 0.30*ml + 0.20*dictNorm + context
	if risk > 1 {
		risk = 1
	}

	categories := make([]string, 0, len(cats))
	for c := range cats {
		categories = append(categories, c)
	}
	sort.Strings(categories)

	return Result{
		Matches:        matches,
		Categories:     categories,
		DictionaryHits: dictHits,
		MLSignal:       ml,
		Risk:           risk,
		Stats: map[string]float64{
			"regex_signal":  regexSignal,
			"regex_norm":    regexNorm,
			"text_len":      float64(len(text)),
			"context_bonus": context,
		},
	}
}

func saturate(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}
