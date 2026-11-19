# FGM Regenerator — реконструкция

Локальные R01–R07/R12 парсеры, наблюдения и детерминированная реконструкция целой сущности. Core и Raster используются локально. Python остаётся необходимой оболочкой для безопасного чтения данных и оркестрации.

## Сборка и разработка

Обычная сборка выполняется из корня [FGM Platform](../README.md). [Архитектура, native/WASM и проверки](../docs/platform.md), [нормативные требования](../requirements/regenerator/), [единая иерархия](../docs/requirements-hierarchy.md). Отдельный репозиторий, lockfile или workflow модуля не требуются.

## Предметные контракты

[R06](docs/r06-reconstruction.md) · [Whole object](docs/r06-s2b2-whole-object.md) · [Совместный fit](docs/r07-whole-source-fit.md).

## Границы

[Текущий roadmap](https://github.com/netkeep80/fgm-platform/issues/15) сохраняет незавершённые задачи и ограничения. Публичные fixtures синтетические. Оригинальные игровые ресурсы остаются в приватном контуре. Модуль сохраняет свою [лицензию](LICENSE).
