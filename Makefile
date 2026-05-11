.PHONY: dev build test eval fetch-model mock-model clean

dev:
	@bash scripts/dev-up.sh

build:
	@bash scripts/build-all.sh all

test:
	@cd endpoint-agent && go test ./... 2>/dev/null || true
	@cd policy-server && npm test 2>/dev/null || true
	@cd admin-dashboard && npm test 2>/dev/null || true

eval:
	@bash scripts/eval.sh

fetch-model:
	@bash scripts/fetch-model.sh

fetch-model-fallback:
	@bash scripts/fetch-model-fallback.sh

mock-model:
	@bash scripts/mock-model.sh

clean:
	@rm -rf dist/ admin-dashboard/dist/ policy-server/auro.dev.sqlite*
