// Package update is a placeholder for the signed-update workflow. The full
// implementation downloads a tar.gz bundle, verifies an Ed25519 detached
// signature with the embedded public key, and atomically swaps the binary
// using Windows Restart Manager (or systemd kill+swap on Linux).
//
// In the scaffolded build it logs a message every 6 h. The dashboard pushes
// the new version metadata and the agent picks it up on next heartbeat.
package update

import (
	"context"
	"log"
	"time"
)

func WatchLoop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 6 * time.Hour
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			log.Printf("update: checking for new agent build (stub)")
		}
	}
}
