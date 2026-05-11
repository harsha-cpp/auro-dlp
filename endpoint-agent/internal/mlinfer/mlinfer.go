//go:build ignore

package mlinfer

import (
	"fmt"
	"math"
	"strings"

	"github.com/knights-analytics/hugot"
	"github.com/knights-analytics/hugot/pipelines"
)

type Engine struct {
	pipeline *pipelines.TokenClassificationPipeline
	session  *hugot.Session
}

func New(modelDir, ortLibPath string) (*Engine, error) {
	sess, err := hugot.NewORTSession(hugot.WithOnnxLibraryPath(ortLibPath))
	if err != nil {
		return nil, fmt.Errorf("ort session: %w", err)
	}
	config := pipelines.TokenClassificationConfig{ModelPath: modelDir, Name: "pii-ner"}
	pipe, err := pipelines.NewPipeline(sess, config)
	if err != nil {
		sess.Destroy()
		return nil, fmt.Errorf("pipeline: %w", err)
	}
	return &Engine{pipeline: pipe, session: sess}, nil
}

func (e *Engine) Close() {
	if e.session != nil {
		e.session.Destroy()
	}
}

func (e *Engine) Score(text string) (float64, []string, error) {
	if len(text) > 4000 {
		text = text[:4000]
	}

	result, err := e.pipeline.RunPipeline([]string{text})
	if err != nil {
		return 0, nil, err
	}

	var entityCount int
	var totalConf float64
	var labels []string
	seen := map[string]bool{}

	for _, batch := range result.GetOutput() {
		for _, entity := range batch {
			if entity.Score < 0.5 {
				continue
			}
			if strings.HasPrefix(entity.Entity, "B-") || strings.HasPrefix(entity.Entity, "I-") {
				entityCount++
				totalConf += float64(entity.Score)
				label := entity.Entity[2:]
				if !seen[label] {
					seen[label] = true
					labels = append(labels, label)
				}
			}
		}
	}

	if entityCount == 0 {
		return 0, nil, nil
	}

	tokenCount := float64(len(strings.Fields(text)))
	avgConf := totalConf / float64(entityCount)
	score := float64(entityCount) * avgConf / math.Max(tokenCount, 10)
	score = math.Min(score, 1.0)
	score = math.Max(score, 0.0)

	return score, labels, nil
}
