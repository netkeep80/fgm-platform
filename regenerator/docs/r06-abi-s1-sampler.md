# R06-ABI-S1 — единая C05-выборка whole-object в native и WASM Worker

**Статус:** кандидатный первый срез [план Platform](https://github.com/netkeep80/fgm-platform/issues/15) после принятого R06-S2B2 PR #42 (историческая запись). Не является реализацией whole-object *reconstruction*, portable B1 verifier или браузерного Studio UI. Архитектурная точка: [план Platform](https://github.com/netkeep80/fgm-platform/issues/15).

## Разделение ответственности и доверия

- **FGM Core C05** остаётся единственной семантикой занятости/материала. Общая C++20 функция `fgmr::sample_whole(package_bytes, material, local_cells)` из `src/whole-sampling.cpp` создаёт фактические маски по 6144 центрам вокселей **каждой** объявленной клетки единой FGM-модели.
- Одна функция используется старым native CLI `fgmr-r06-multicell-sample` и существующим `fgmr-studio-run`, который собирается также в WASM через `src/studio-wasm.cpp`. Никакой альтернативной JS-реализации C05 или генератора в Worker нет.
- `scripts/assemble_r06_multicell.py` **по-прежнему** строит пакет нативно и проверяет B1 membership SHA + выбранные локальные R03 snapshots. В браузере этот этап не доступен. Браузер принимает готовый `fgm-package/1` с `generation.algorithm=r06_multicell_loft_boxes`, `version=0.1.0`. Передача готового пакета/списка клеток **не доказывает подлинность B1/R03** и не выполняет аттестацию происхождения. Отдельный verified receipt/portable reconstruction — последующий S43-срез.
- Whole-object `model_sha256` из B2 остаётся **хешем байтов пакета**, а не C04 semantic model hash. Отдельное identity-кодирование — долг #42 P3-02.

## Протокол Studio v1: `r06-whole-sample/1`

Существующие `r06-occupancy/1` и `r06-cell/1` остаются неизменными. Клиент native stdin или WASM Worker передаёт одну JSON-строку:

```json
{"v":1,"action":"start","spec":{
  "algorithm":"r06-whole-sample/1",
  "coreRevision":"ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b",
  "seed":"<64 hex из model.seed>",
  "budget":12288,
  "sourceBindings":[{"role":"model","bytes":"<полный текст FGM package>"}],
  "parameters":{"material":"stone","cells":[{"local_xyz":[0,0,0]},{"local_xyz":[1,0,0]}]}
}}
```

Затем `{"v":1,"action":"step","runId":1}` и `{"v":1,"action":"finalize","runId":1}`. Возвращается `result.whole` схемы `fgm-regenerator/whole-object-sampling-v1`: `cells[{local_xyz,mask}]`; маска — 6144 бит в порядке Z–Y–X. Ошибки не содержат сырые данные или пути. `pause/resume/cancel` относятся к ожиданию между сообщениями; `step` **атомарен и не может быть отменён посередине**. Не выдавать его за итерационный `step`.

Негативные проверки: недостоверный seed, несоответствие версии Core, duplicate local cell, неверный budget и материал, stale runId, отмена до step. Никакие данные пользователя не сохраняются в браузерное хранилище. Внутренний Worker ограничен памятью WASM 32 МиБ, протоколом 128 КиБ и пакетом 48 КиБ; допустимо 2–8 разных клеток, локальные координаты [-16,16] каждой оси и материал `[a-z][a-z0-9_]*` длиной до 48. Это ограничение относится только к Studio ABI: общий C++20 C05 sampler и прежний native B2 CLI сохраняют поддерживаемый предел **80 символов** для материала `[a-z][a-z0-9_]*`. Проверки B2 на длинах 49, 60, 80 и отказе на 81 выполняются на Ubuntu/Windows; отдельная отрицательная проверка гарантирует лимит 48 для Studio. Эта **ограниченная пробная квота** не покрывает все пакеты до 4 МиБ, принимаемые локальным B2.

## Проверка и следующая зависимость

`tests/test_studio_whole.mjs` формирует **реальные B2 canonical packages через принятый Python assembler** из свободных синтетических B1 receipt и R03 row masks: две клетки со стыком, 2×2 с отверстием, Z-стык с ненулевым anchor. Для каждого случая тот же package подаётся native CLI, native Studio Runner и WASM Worker; сравниваются полные фактические маски C05 и bytewise одинаковые Studio replies. Дополнительно выполняется real Chromium Worker smoke и проверяются отрицательные сценарии. Нет оригинальных ресурсов UFO/TFTD.

**Дальнейший S43-S2:** вынести в C++20 сам алгоритм B2 `BuildWholeObject` (membership-v1 input → canonical FGM-0 + C05 + derived SliceByCell), жёстко определить доверенность B1 receipt в браузере, добавить native/WASM parity на одинаковых исходных байтах, проверяемые hash domains и bounded incremental/cancel только при реально инкрементальных операциях. После отдельного PASS/авторского принятия — Renderer #38, repin и Studio; текущая Pages Studio не меняется.
