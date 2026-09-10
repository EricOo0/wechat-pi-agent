# 逐文件迁移归属审计

基线 HEAD：`f549d22bce908349ac57349b855232825e7be204`。本地扫描日期：2026-09-10。共 **109 个 src 文件**，每个文件都有目标职责归属。这里只记录迁移设计，没有移动代码。

[重构规格](spec.md) · [功能验收覆盖](coverage.md)

目标路径相对于拟定 src。`+` 表示必须按职责拆开，不是复制两份实现；部分目录级映射须在实施计划中细化。旧 Pi 工具文件中的业务操作迁往所属能力服务，Pi 工具定义保留为协议桥接。

| 当前文件 | 目标模块或路径 |
|---|---|
| [src/adapters/inbound/admin-http/memory-trace.ts](../../../src/adapters/inbound/admin-http/memory-trace.ts) | `modules/observability/application` |
| [src/adapters/inbound/admin-http/model-routes.ts](../../../src/adapters/inbound/admin-http/model-routes.ts) | `entrypoints/admin-http` |
| [src/adapters/inbound/admin-http/model-settings-page.ts](../../../src/adapters/inbound/admin-http/model-settings-page.ts) | `entrypoints/admin-http` |
| [src/adapters/inbound/admin-http/runtime-health.ts](../../../src/adapters/inbound/admin-http/runtime-health.ts) | `modules/observability/application` |
| [src/adapters/inbound/admin-http/server.ts](../../../src/adapters/inbound/admin-http/server.ts) | `entrypoints/admin-http` |
| [src/adapters/inbound/admin-http/trace-model.ts](../../../src/adapters/inbound/admin-http/trace-model.ts) | `modules/observability/application` |
| [src/adapters/inbound/admin-http/trace-page.ts](../../../src/adapters/inbound/admin-http/trace-page.ts) | `entrypoints/admin-http` |
| [src/adapters/inbound/ilink/poll-loop.ts](../../../src/adapters/inbound/ilink/poll-loop.ts) | `workers + modules/messaging/application` |
| [src/adapters/outbound/filesystem/local-file-storage.ts](../../../src/adapters/outbound/filesystem/local-file-storage.ts) | `adapters/filesystem` |
| [src/adapters/outbound/filesystem/markdown-memory-store.ts](../../../src/adapters/outbound/filesystem/markdown-memory-store.ts) | `adapters/filesystem` |
| [src/adapters/outbound/ilink/dry-run-channel.ts](../../../src/adapters/outbound/ilink/dry-run-channel.ts) | `adapters/dry-run` |
| [src/adapters/outbound/ilink/file-credential-store.ts](../../../src/adapters/outbound/ilink/file-credential-store.ts) | `adapters/ilink` |
| [src/adapters/outbound/ilink/ilink-file-downloader.ts](../../../src/adapters/outbound/ilink/ilink-file-downloader.ts) | `adapters/ilink` |
| [src/adapters/outbound/ilink/ilink-http-client.ts](../../../src/adapters/outbound/ilink/ilink-http-client.ts) | `adapters/ilink` |
| [src/adapters/outbound/ilink/ilink-image-downloader.ts](../../../src/adapters/outbound/ilink/ilink-image-downloader.ts) | `adapters/ilink` |
| [src/adapters/outbound/ilink/protocol-types.ts](../../../src/adapters/outbound/ilink/protocol-types.ts) | `adapters/ilink` |
| [src/adapters/outbound/ilink/qr-login.ts](../../../src/adapters/outbound/ilink/qr-login.ts) | `adapters/ilink` |
| [src/adapters/outbound/observability/logger.ts](../../../src/adapters/outbound/observability/logger.ts) | `adapters/telemetry` |
| [src/adapters/outbound/observability/metrics.ts](../../../src/adapters/outbound/observability/metrics.ts) | `adapters/telemetry` |
| [src/adapters/outbound/pi/conversation-context.ts](../../../src/adapters/outbound/pi/conversation-context.ts) | `modules/context + adapters/pi` |
| [src/adapters/outbound/pi/dry-run-agent.ts](../../../src/adapters/outbound/pi/dry-run-agent.ts) | `adapters/dry-run` |
| [src/adapters/outbound/pi/file-input/codex/codex-file-input.ts](../../../src/adapters/outbound/pi/file-input/codex/codex-file-input.ts) | `adapters/codex-files` |
| [src/adapters/outbound/pi/file-input/codex/codex-file-upload.ts](../../../src/adapters/outbound/pi/file-input/codex/codex-file-upload.ts) | `adapters/codex-files` |
| [src/adapters/outbound/pi/file-input/model-file-input-router.ts](../../../src/adapters/outbound/pi/file-input/model-file-input-router.ts) | `modules/artifacts/application` |
| [src/adapters/outbound/pi/file-input/redact-file-errors.ts](../../../src/adapters/outbound/pi/file-input/redact-file-errors.ts) | `modules/artifacts/application` |
| [src/adapters/outbound/pi/model-call-trace.ts](../../../src/adapters/outbound/pi/model-call-trace.ts) | `modules/observability + adapters/pi` |
| [src/adapters/outbound/pi/pi-agent-gateway.ts](../../../src/adapters/outbound/pi/pi-agent-gateway.ts) | `runtime/agent + adapters/pi` |
| [src/adapters/outbound/pi/pi-memory-generator.ts](../../../src/adapters/outbound/pi/pi-memory-generator.ts) | `adapters/pi` |
| [src/adapters/outbound/pi/pi-model-catalog.ts](../../../src/adapters/outbound/pi/pi-model-catalog.ts) | `adapters/models` |
| [src/adapters/outbound/pi/pi-provider-authentication.ts](../../../src/adapters/outbound/pi/pi-provider-authentication.ts) | `modules/models/application + adapters/models` |
| [src/adapters/outbound/pi/provider-request-gate.ts](../../../src/adapters/outbound/pi/provider-request-gate.ts) | `modules/models/application` |
| [src/adapters/outbound/pi/skill-catalog.ts](../../../src/adapters/outbound/pi/skill-catalog.ts) | `modules/skills + adapters/pi` |
| [src/adapters/outbound/pi/staged-credential-store.ts](../../../src/adapters/outbound/pi/staged-credential-store.ts) | `adapters/models` |
| [src/adapters/outbound/pi/system-prompt.ts](../../../src/adapters/outbound/pi/system-prompt.ts) | `modules/context + adapters/pi` |
| [src/adapters/outbound/pi/tools/file-tools.ts](../../../src/adapters/outbound/pi/tools/file-tools.ts) | `modules/tools/application + adapters/pi/tools` |
| [src/adapters/outbound/pi/tools/index.ts](../../../src/adapters/outbound/pi/tools/index.ts) | `modules/tools/application + adapters/pi/tools` |
| [src/adapters/outbound/pi/tools/memory-tools.ts](../../../src/adapters/outbound/pi/tools/memory-tools.ts) | `modules/tools/application + adapters/pi/tools` |
| [src/adapters/outbound/pi/trace-snapshot.ts](../../../src/adapters/outbound/pi/trace-snapshot.ts) | `modules/observability` |
| [src/adapters/outbound/pi/user-memory-context.ts](../../../src/adapters/outbound/pi/user-memory-context.ts) | `modules/context + adapters/pi` |
| [src/adapters/outbound/sandbox/local-sandbox-executor.ts](../../../src/adapters/outbound/sandbox/local-sandbox-executor.ts) | `adapters/sandbox` |
| [src/adapters/outbound/sandbox/supervisor.mjs](../../../src/adapters/outbound/sandbox/supervisor.mjs) | `adapters/sandbox` |
| [src/adapters/outbound/sandbox/tool-worker.mjs](../../../src/adapters/outbound/sandbox/tool-worker.mjs) | `adapters/sandbox` |
| [src/adapters/outbound/sqlite/index.ts](../../../src/adapters/outbound/sqlite/index.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/migrations.ts](../../../src/adapters/outbound/sqlite/migrations.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/sqlite-control-plane.ts](../../../src/adapters/outbound/sqlite/sqlite-control-plane.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/sqlite-memory-job-repository.ts](../../../src/adapters/outbound/sqlite/sqlite-memory-job-repository.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/sqlite-model-selection-repository.ts](../../../src/adapters/outbound/sqlite/sqlite-model-selection-repository.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/sqlite-permission-repository.ts](../../../src/adapters/outbound/sqlite/sqlite-permission-repository.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/adapters/outbound/sqlite/sqlite-user-file-repository.ts](../../../src/adapters/outbound/sqlite/sqlite-user-file-repository.ts) | `adapters/sqlite (按核心端口拆分，保留原子事务)` |
| [src/application/interfaces/agent.ts](../../../src/application/interfaces/agent.ts) | `runtime/agent/ports` |
| [src/application/interfaces/channel.ts](../../../src/application/interfaces/channel.ts) | `modules/messaging/ports` |
| [src/application/interfaces/control-plane.ts](../../../src/application/interfaces/control-plane.ts) | `modules/messaging/ports + modules/turns/ports + modules/conversation/ports + modules/observability/ports` |
| [src/application/interfaces/file-storage.ts](../../../src/application/interfaces/file-storage.ts) | `modules/artifacts/ports` |
| [src/application/interfaces/memory-generator.ts](../../../src/application/interfaces/memory-generator.ts) | `modules/memory/ports` |
| [src/application/interfaces/memory-job-repository.ts](../../../src/application/interfaces/memory-job-repository.ts) | `modules/memory/ports` |
| [src/application/interfaces/memory-store.ts](../../../src/application/interfaces/memory-store.ts) | `modules/memory/ports` |
| [src/application/interfaces/model-catalog.ts](../../../src/application/interfaces/model-catalog.ts) | `modules/models/ports` |
| [src/application/interfaces/model-file-input.ts](../../../src/application/interfaces/model-file-input.ts) | `modules/artifacts/ports` |
| [src/application/interfaces/model-selection-repository.ts](../../../src/application/interfaces/model-selection-repository.ts) | `modules/models/ports` |
| [src/application/interfaces/permission-repository.ts](../../../src/application/interfaces/permission-repository.ts) | `modules/permissions/ports` |
| [src/application/interfaces/provider-authentication.ts](../../../src/application/interfaces/provider-authentication.ts) | `modules/models/ports` |
| [src/application/interfaces/sandbox-executor.ts](../../../src/application/interfaces/sandbox-executor.ts) | `modules/execution/ports` |
| [src/application/interfaces/session-lifecycle-repository.ts](../../../src/application/interfaces/session-lifecycle-repository.ts) | `modules/conversation/ports` |
| [src/application/interfaces/telemetry.ts](../../../src/application/interfaces/telemetry.ts) | `modules/observability/ports` |
| [src/application/interfaces/user-file-repository.ts](../../../src/application/interfaces/user-file-repository.ts) | `modules/artifacts/ports` |
| [src/application/services/command-catalog.ts](../../../src/application/services/command-catalog.ts) | `entrypoints/wechat` |
| [src/application/services/command-router.ts](../../../src/application/services/command-router.ts) | `entrypoints/wechat` |
| [src/application/services/permission-service.ts](../../../src/application/services/permission-service.ts) | `modules/permissions/application` |
| [src/application/services/policy-compiler.ts](../../../src/application/services/policy-compiler.ts) | `modules/execution/domain` |
| [src/application/services/reply-chunker.ts](../../../src/application/services/reply-chunker.ts) | `entrypoints/wechat + messaging/application` |
| [src/application/services/user-memory-service.ts](../../../src/application/services/user-memory-service.ts) | `modules/memory/application` |
| [src/application/use-cases/deliver-reply.ts](../../../src/application/use-cases/deliver-reply.ts) | `modules/messaging/application/workflows` |
| [src/application/use-cases/end-session.ts](../../../src/application/use-cases/end-session.ts) | `modules/conversation/application/workflows` |
| [src/application/use-cases/expire-idle-sessions.ts](../../../src/application/use-cases/expire-idle-sessions.ts) | `modules/conversation/application` |
| [src/application/use-cases/generate-session-memory.ts](../../../src/application/use-cases/generate-session-memory.ts) | `modules/memory/application/workflows` |
| [src/application/use-cases/ingest-message.ts](../../../src/application/use-cases/ingest-message.ts) | `modules/messaging/application/workflows` |
| [src/application/use-cases/memory-worker-loop.ts](../../../src/application/use-cases/memory-worker-loop.ts) | `workers` |
| [src/application/use-cases/outbox-worker-loop.ts](../../../src/application/use-cases/outbox-worker-loop.ts) | `workers` |
| [src/application/use-cases/recover-interrupted-work.ts](../../../src/application/use-cases/recover-interrupted-work.ts) | `bootstrap/lifecycle + turns/application + messaging/application` |
| [src/application/use-cases/run-next-turn.ts](../../../src/application/use-cases/run-next-turn.ts) | `modules/turns/application/workflows + runtime/agent` |
| [src/application/use-cases/save-inbound-files.ts](../../../src/application/use-cases/save-inbound-files.ts) | `modules/artifacts/application/workflows` |
| [src/application/use-cases/select-model.ts](../../../src/application/use-cases/select-model.ts) | `modules/models/application` |
| [src/application/use-cases/turn-worker-loop.ts](../../../src/application/use-cases/turn-worker-loop.ts) | `workers` |
| [src/bootstrap/config.ts](../../../src/bootstrap/config.ts) | `bootstrap` |
| [src/bootstrap/container.ts](../../../src/bootstrap/container.ts) | `bootstrap` |
| [src/bootstrap/ilink-login.ts](../../../src/bootstrap/ilink-login.ts) | `entrypoints/cli` |
| [src/bootstrap/main.ts](../../../src/bootstrap/main.ts) | `bootstrap` |
| [src/bootstrap/pi-onboarding.ts](../../../src/bootstrap/pi-onboarding.ts) | `entrypoints/cli` |
| [src/bootstrap/service-lock.ts](../../../src/bootstrap/service-lock.ts) | `bootstrap` |
| [src/domain/conversation/context-event.ts](../../../src/domain/conversation/context-event.ts) | `modules/conversation/domain` |
| [src/domain/conversation/session.ts](../../../src/domain/conversation/session.ts) | `modules/conversation/domain` |
| [src/domain/delivery/outbox-message.ts](../../../src/domain/delivery/outbox-message.ts) | `modules/messaging/domain` |
| [src/domain/execution/step.ts](../../../src/domain/execution/step.ts) | `modules/observability/domain` |
| [src/domain/execution/turn.ts](../../../src/domain/execution/turn.ts) | `modules/turns/domain` |
| [src/domain/files/user-file.ts](../../../src/domain/files/user-file.ts) | `modules/artifacts/domain` |
| [src/domain/memory/memory-job.ts](../../../src/domain/memory/memory-job.ts) | `modules/memory/domain` |
| [src/domain/memory/user-memory.ts](../../../src/domain/memory/user-memory.ts) | `modules/memory/domain` |
| [src/domain/messaging/inbound-message.ts](../../../src/domain/messaging/inbound-message.ts) | `modules/messaging/domain` |
| [src/domain/messaging/outbound-message.ts](../../../src/domain/messaging/outbound-message.ts) | `modules/messaging/domain` |
| [src/domain/models/model-selection.ts](../../../src/domain/models/model-selection.ts) | `modules/models/domain` |
| [src/domain/policy/permissions.ts](../../../src/domain/policy/permissions.ts) | `modules/permissions/domain` |
| [src/domain/policy/sender-policy.ts](../../../src/domain/policy/sender-policy.ts) | `modules/messaging/domain` |
| [src/prompts/memory-extract.md](../../../src/prompts/memory-extract.md) | `prompts` |
| [src/prompts/memory-merge.md](../../../src/prompts/memory-merge.md) | `prompts` |
| [src/prompts/wechat-assistant.md](../../../src/prompts/wechat-assistant.md) | `prompts` |
| [src/shared/clock.ts](../../../src/shared/clock.ts) | `shared` |
| [src/shared/ids.ts](../../../src/shared/ids.ts) | `shared` |
| [src/shared/result.ts](../../../src/shared/result.ts) | `shared` |
| [src/shared/sleep.ts](../../../src/shared/sleep.ts) | `shared` |
