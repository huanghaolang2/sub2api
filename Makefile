.PHONY: build build-backend build-frontend build-frontend2 test test-backend test-frontend test-frontend-critical up restart stop-dev

PNPM_VERSION ?= 9.15.9
PNPM := npx --yes pnpm@$(PNPM_VERSION)
COMPOSE_PROJECT_NAME ?= deploy
COMPOSE_ENV_FILE := $(CURDIR)/deploy/.env
COMPOSE_BASE_FILE := $(CURDIR)/deploy/docker-compose.standalone.yml
COMPOSE_WORKSPACE_FILE := $(CURDIR)/deploy/docker-compose.workspace.yml
COMPOSE := docker compose --project-name "$(COMPOSE_PROJECT_NAME)" --env-file "$(COMPOSE_ENV_FILE)" -f "$(COMPOSE_BASE_FILE)" -f "$(COMPOSE_WORKSPACE_FILE)"
DOCKER_SERVICES := sub2api frontend frontend2

FRONTEND_CRITICAL_VITEST := \
	src/api/__tests__/client.spec.ts \
	src/api/__tests__/tokenRefresh.spec.ts \
	src/views/auth/__tests__/LinuxDoCallbackView.spec.ts \
	src/views/auth/__tests__/WechatCallbackView.spec.ts \
	src/views/user/__tests__/PaymentView.spec.ts \
	src/views/user/__tests__/PaymentResultView.spec.ts \
	src/components/user/profile/__tests__/ProfileInfoCard.spec.ts \
	src/views/admin/__tests__/SettingsView.spec.ts

# 一键编译后端和两个前端
build: build-backend build-frontend build-frontend2

# 构建后端 Docker 镜像。
build-backend:
	@$(COMPOSE) build sub2api

# 构建原前端 Docker 镜像。
build-frontend:
	@$(COMPOSE) build frontend

# 构建新版前端 Docker 镜像。
build-frontend2:
	@$(COMPOSE) build frontend2

# 运行测试（后端 + 前端）
test: test-backend test-frontend

test-backend:
	@$(MAKE) -C backend test

test-frontend:
	@$(PNPM) --dir frontend run lint:check
	@$(PNPM) --dir frontend run typecheck
	@$(MAKE) test-frontend-critical

test-frontend-critical:
	@$(PNPM) --dir frontend exec vitest run $(FRONTEND_CRITICAL_VITEST)

# 首次创建并启动三个 Docker 服务；不会构建镜像。
up:
	@$(COMPOSE) up -d --no-build $(DOCKER_SERVICES)

# 停止三个 Docker 服务，不删除容器和数据卷。
stop-dev:
	@$(COMPOSE) stop $(DOCKER_SERVICES)

# 停止正在运行的容器，跳过未运行的容器，然后启动全部 Docker 服务。
restart:
	@set -eu; \
	running="$$( $(COMPOSE) ps --status running --services )"; \
	stop_targets=""; \
	for service in $(DOCKER_SERVICES); do \
		if printf '%s\n' "$$running" | grep -qx "$$service"; then \
			stop_targets="$$stop_targets $$service"; \
		else \
			echo "[skip] Docker 服务 $$service 未运行，无需停止"; \
		fi; \
	done; \
	if [ -n "$$stop_targets" ]; then \
		$(COMPOSE) stop $$stop_targets; \
	fi; \
	$(COMPOSE) up -d --no-build $(DOCKER_SERVICES); \
	echo "[ok] Docker 服务已全部启动"; \
	echo "[访问地址]"; \
	started="$$( $(COMPOSE) ps --status running --services )"; \
	for service in $(DOCKER_SERVICES); do \
		if printf '%s\n' "$$started" | grep -qx "$$service"; then \
			case "$$service" in \
				sub2api) container_port=8080 ;; \
				frontend) container_port=3000; label="frontend" ;; \
				frontend2) container_port=3000; label="frontend2" ;; \
			esac; \
			binding="$$( $(COMPOSE) port "$$service" "$$container_port" 2>/dev/null | head -n 1 )"; \
			if [ -n "$$binding" ]; then \
				host_port="$${binding##*:}"; \
				if [ "$$service" = "sub2api" ]; then \
					echo "  backend health: http://localhost:$$host_port/health"; \
					echo "  backend panel API: http://localhost:$$host_port/api/v1"; \
					echo "  backend gateway API: http://localhost:$$host_port/v1"; \
				else \
					echo "  $$label: http://localhost:$$host_port"; \
				fi; \
			fi; \
		fi; \
	done
