# FGM Renderer и Studio

Scene/camera, RendererSession и WebGPU используют локальный Core. Общая RVI реализация принадлежит Raster. Браузерный интерфейс расположен в studio/ и исполняет Worker, собранный из того же Platform checkout.

## Сборка и разработка

Обычная сборка выполняется из корня [FGM Platform](../README.md). [Архитектура, native/WASM и проверки](../docs/platform.md), [нормативные требования](../requirements/renderer/), [единая иерархия](../docs/requirements-hierarchy.md). Отдельный репозиторий, lockfile или workflow модуля не требуются.

## Предметные контракты

[RendererSession](docs/renderer-session-v1.md) · [Камера](docs/v03-camera.md) · [Пакет Studio](docs/studio-pages.md).

## Границы

[Текущий roadmap](https://github.com/netkeep80/fgm-platform/issues/15) сохраняет незавершённые задачи и ограничения. Публичные fixtures синтетические. Оригинальные игровые ресурсы остаются в приватном контуре. Модуль сохраняет свою [лицензию](LICENSE).
