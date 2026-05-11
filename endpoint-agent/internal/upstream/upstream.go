package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

type Client struct {
	ServerURL  string
	EndpointID string
	Version    string
	httpClient *http.Client
	incidents  chan []byte
	mu         sync.Mutex
}

func New(serverURL, endpointID, version string) *Client {
	c := &Client{
		ServerURL:  serverURL,
		EndpointID: endpointID,
		Version:    version,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		incidents:  make(chan []byte, 256),
	}
	return c
}

type heartbeatPayload struct {
	EndpointID    string `json:"endpoint_id"`
	Hostname      string `json:"hostname"`
	UserPrincipal string `json:"user_principal"`
	Version       string `json:"version"`
	PolicyVersion string `json:"policy_version"`
	LastSeen      string `json:"last_seen"`
}

func (c *Client) Heartbeat(ctx context.Context, policyVersion string) error {
	if c.ServerURL == "" {
		return nil
	}
	hostname, _ := os.Hostname()
	payload := heartbeatPayload{
		EndpointID:    c.EndpointID,
		Hostname:      hostname,
		UserPrincipal: os.Getenv("USER"),
		Version:       c.Version,
		PolicyVersion: policyVersion,
		LastSeen:      time.Now().UTC().Format(time.RFC3339),
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ServerURL+"/agents/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) HeartbeatLoop(ctx context.Context, policyVersion func() string) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := c.Heartbeat(ctx, policyVersion()); err != nil {
				log.Printf("upstream heartbeat: %v", err)
			}
		}
	}
}

func (c *Client) ForwardIncident(ctx context.Context, incident any) {
	body, err := json.Marshal(incident)
	if err != nil {
		return
	}
	select {
	case c.incidents <- body:
	default:
		log.Printf("upstream: incident buffer full, dropping")
	}
}

func (c *Client) WorkerLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case body := <-c.incidents:
			c.postIncident(ctx, body)
		}
	}
}

func (c *Client) postIncident(ctx context.Context, body []byte) {
	if c.ServerURL == "" {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ServerURL+"/incidents", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		log.Printf("upstream: incident post failed: %v (will retry)", err)
		// Re-queue for retry
		select {
		case c.incidents <- body:
		default:
		}
		time.Sleep(30 * time.Second)
		return
	}
	resp.Body.Close()
}

func (c *Client) VerifyOverride(ctx context.Context, incidentID, totp string) (bool, error) {
	if c.ServerURL == "" {
		return false, fmt.Errorf("no policy server configured")
	}
	payload, _ := json.Marshal(map[string]string{
		"incident_id": incidentID,
		"totp":        totp,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ServerURL+"/admin/override/verify", bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	var result struct {
		Approved bool   `json:"approved"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, err
	}
	return result.Approved, nil
}
