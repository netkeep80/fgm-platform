# FGM Platform — единая платформа Fractal Generative Models

Статус: **MIGRATION PREPARATION**. Сюда планируется перенести `fgm-core`, `fgm-regenerator`, `fgm-renderer` и Web Studio. **Ни один из трёх продуктов пока не перенесён.** Этот bootstrap PR устанавливает только основу управления требованиями и CI.

**Единственная точка восстановления проекта после окончания чата:** [CONTROL Issue #1](https://github.com/netkeep80/fgm-platform/issues/1). [Протокол журнала и контрольных точек #2](https://github.com/netkeep80/fgm-platform/issues/2). [Начальный этап RepoGuard #3](https://github.com/netkeep80/fgm-platform/issues/3). [Покрытие старой истории/roadmap #15](https://github.com/netkeep80/fgm-platform/issues/15).

## Назначение и границы

- `core/` (будущий): FGM-0, каноническая модель, математическая семантика, C04/C05.
- `regenerator/` (будущий): R01–R07, исходные наблюдения, происхождение данных, whole-object fit.
- `renderer/` (будущий): RendererSession, WebGPU и производная геометрия.
- `studio/` (будущий): общий Native/WASM интерфейс, локальный эксперимент и проверенный автоматический Pages release.

`netkeep80/ufo-fractal` остаётся отдельным игровым GPLv3-продуктом. Оригинальные данные UFO/TFTD и производные игровые ресурсы остаются в приватном контуре; **никаких** MAP/MCD/LOFT/PCK/TAB/game images/derived FGM в публичном GitHub, Issues, CI или Pages.

## Управление принятием

Единственные нормативные источники этого начального среза — файлы `requirements/FGMP-*.rg.yaml`. `accepted:true` внутри **Draft PR** — предлагаемое значение для будущего принятого снапшота, **не самостоятельная авторская приёмка**. До независимого аудита exact HEAD/TREE и явного авторского подтверждения нельзя переводить PR в Ready/merge или объявлять требования действующими.

RepoGuard v6.0.1 закреплён на `74db97791e6da8a75287164f0d0b41579108f114`. CI выполняет локальные положительные и отрицательные проверки bootstrap и затем RepoGuard `base/head`. Настоящая блокирующая защита `main` требует отдельной настройки required check в GitHub rulesets; зелёный workflow сам по себе не доказывает включённую protection.

## Очередность

[S00 RepoGuard](https://github.com/netkeep80/fgm-platform/issues/3) → [S01 source lock](https://github.com/netkeep80/fgm-platform/issues/4) → [S02 Git history](https://github.com/netkeep80/fgm-platform/issues/5) → [S03 requirement migration](https://github.com/netkeep80/fgm-platform/issues/6) → [S04 Core](https://github.com/netkeep80/fgm-platform/issues/7) → [S05 Regenerator](https://github.com/netkeep80/fgm-platform/issues/8) → [S06 Renderer](https://github.com/netkeep80/fgm-platform/issues/9) → [S07 Live Studio](https://github.com/netkeep80/fgm-platform/issues/10) → [S08 cutover](https://github.com/netkeep80/fgm-platform/issues/14).

**Пока основной код не перенесён и новый live Studio не выпущен, прежние проекты остаются историческим источником authority и нынешний Pages-сайт не затрагивается.**
