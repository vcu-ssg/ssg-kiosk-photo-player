# -------------------------------------------
# Makefile for ssg-kiosk-photo-player
# -------------------------------------------

# Default settings
APP_NAME := ssg-kiosk-photo-player
CONTAINER := photo-kiosk
PORT := 3000

AUTOSTART_FILE := $(HOME)/.config/lxsession/LXDE-pi/autostart
AUTOSTART_SNIPPET := @bash -c "cd $(HOME)/projects/$(APP_NAME) && make up" && \
                     @chromium-browser --kiosk --noerrdialogs --disable-infobars \
                     --check-for-update-interval=31536000 --incognito --no-first-run http://localhost:$(PORT)


# Docker image and tag
IMAGE := $(APP_NAME):latest

# Detect if docker compose v2 (modern syntax)
DOCKER_COMPOSE := docker compose

# -----------------------------
# Primary Targets
# -----------------------------

.PHONY: help install build up down logs restart clean rebuild prune status

help:
	@echo ""
	@echo "📸  $(APP_NAME) — Makefile Commands"
	@echo "-------------------------------------------"
	@echo "make install     - Install Node dependencies locally"
	@echo "make build       - Build Docker image"
	@echo "make up          - Start container (detached)"
	@echo "make down        - Stop and remove container"
	@echo "make logs        - Tail container logs"
	@echo "make restart     - Restart container"
	@echo "make clean       - Remove node_modules and build artifacts"
	@echo "make rebuild     - Rebuild Docker image and restart"
	@echo "make prune       - Remove dangling Docker images"
	@echo "make status      - Show running containers"
	@echo ""

# -----------------------------
# Local development
# -----------------------------

install:
	npm install

dev:
	@echo "🚀 Starting local Node server on port $(PORT)"
	NODE_ENV=development node server.js

clean:
	rm -rf node_modules
	rm -f npm-debug.log

# -----------------------------
# Docker targets
# -----------------------------

build:
	$(DOCKER_COMPOSE) build

up:
	$(DOCKER_COMPOSE) up -d
	@echo "✅ Server running at http://localhost:$(PORT)"

down:
	$(DOCKER_COMPOSE) down

logs:
	$(DOCKER_COMPOSE) logs -f

restart:
	$(DOCKER_COMPOSE) down
	$(DOCKER_COMPOSE) up -d

rebuild:
	$(DOCKER_COMPOSE) up -d --build

status:
	@docker ps --filter "name=$(CONTAINER)"

prune:
	docker image prune -f

# -----------------------------
# Kiosk target (launch Chromium)
# -----------------------------

kiosk:
	@echo "🚀 Launching Chromium in kiosk mode at http://localhost:$(PORT)"
	@chromium-browser --kiosk --noerrdialogs --disable-infobars \
		--check-for-update-interval=31536000 \
		--incognito http://localhost:$(PORT)

# -----------------------------
# Raspberry Pi autostart setup
# -----------------------------

autostart:
	@echo "🛠️  Configuring Raspberry Pi autostart..."
	@mkdir -p $(dir $(AUTOSTART_FILE))
	@if ! grep -q "ssg-kiosk-photo-player" $(AUTOSTART_FILE) 2>/dev/null; then \
		echo "@bash -c 'cd $(HOME)/projects/$(APP_NAME) && make up'" >> $(AUTOSTART_FILE); \
		echo "@chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 --incognito --no-first-run http://localhost:$(PORT)" >> $(AUTOSTART_FILE); \
		echo "✅ Added kiosk autostart to LXDE."; \
	else \
		echo "ℹ️  Autostart already configured."; \
	fi

uninstall-autostart:
	@echo "🧹 Removing kiosk autostart from LXDE..."
	@if test -f $(AUTOSTART_FILE); then \
		sed -i '/ssg-kiosk-photo-player/d' $(AUTOSTART_FILE); \
		sed -i '/chromium-browser --kiosk/d' $(AUTOSTART_FILE); \
		echo "✅ Autostart entries removed."; \
	else \
		echo "⚠️  No autostart file found at $(AUTOSTART_FILE)."; \
	fi