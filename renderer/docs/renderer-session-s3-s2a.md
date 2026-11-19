# S3-S2A — исполняемый диагностический RendererSession

**Статус:** кандидат реализации, не принят и не опубликован. [план Platform](https://github.com/netkeep80/fgm-platform/issues/15) · [план Platform](https://github.com/netkeep80/fgm-platform/issues/15) · [план Platform](https://github.com/netkeep80/fgm-platform/issues/15).

## 1. Граница первого работающего среза

Модуль `runtime/renderer-session-v1.ts` реализует **реальный жизненный цикл** принятого типового контракта `RendererSessionV1`, но только в одном диагностическом backend `canvas2d-diagnostic`. Это отдельная библиотека, пока **не подключённая** к Reconstruction Studio, WebGPU-пути `web/main.ts` либо игровому клиенту. Публичная Studio 1.21 и принятый C++20/WASM Regenerator остаются без изменений.

На вход подаются **готовые** `fgm-package/1` bytes и соответствующий производный `obj/1` mesh. Рендерер не восстанавливает B1/R03, не строит canonical geometry и не проверяет C04/C05/LOFT: это обязанности Core и Regenerator. Пакет считается допустимым для визуализации только в ограниченном смысле: синтаксическая оболочка `format`, SHA-256 его неизменяемых байтов и связанный SHA-256 OBJ. Подписей, первичной аттестации или семантической C04-эквивалентности здесь нет.

**Ограничение:** ровно одна модель, один экземпляр, одна производная `obj/1` mesh с двумя-восьмью опциональными клеточными привязками. Статический `WorldPlacement` поддерживает 4 четверть-оборота в плоскости XY, перенос в FGM-вокселях, камеру `orbit-3d`. `r05-isometric` и WebGPU пока не поддерживаются этим backend. Это не заменяет принятый single-cell R05.

## 2. Проверяемое доверие и детерминизм

- Прежде первого асинхронного digest проверяются типы и границы размеров `Uint8Array`, byteLength, идентификаторы модели, экземпляра, схемы и пространственное размещение. Максимум 1 МиБ на blob и 2 МиБ суммарно.
- Каждый input `Uint8Array` копируется **синхронно до первого await**; `SharedArrayBuffer` отвергается. Поэтому последующая мутация массива вызывающей стороны не меняет результат загрузки.
- SHA-256 вычисляется для *реальных байтов* через `crypto.subtle.digest`. Отдельно проверяются package SHA и mesh SHA; `sourcePackageSha256` производной геометрии обязан совпасть с пакетом. Вход с `verifiedC04Identity` отвергается, пока не подключён независимый утверждённый Core-validator.
- Для `obj/1` выполняется ограниченный UTF-8 парсер: вершины только конечные, грани 3–4 вершин, индексы в диапазоне, не более 20 000 вершин и граней. Визуализация — диагностическая, с сортировкой граней по срединной глубине, **не** доказательство правильной видимости/коллизий.
- `geometryCacheKey` связывает **source package SHA, mesh SHA, mesh format, algorithmId, algorithmVersion, parametersSha256, deterministicSeed, detailDepth, geometryProfileSha256**. Кэш как хранилище ещё не реализован; ключ проверяется исполняемыми негативными тестами.
- Смена чисто визуального профиля и камеры не меняет канонические входные байты. Профиль, меняющий mesh, должен совпадать с `geometryProfileSha256`, иначе `E_SESSION_PROFILE_GEOMETRY`.

## 3. Жизненный цикл и явный отказ

`loadScene` сбрасывает старую сцену и инкрементирует epoch **до** валидации; при отказе никакой старый или новый кадр недоступен. `setView` обновляет epoch и сбрасывает устаревший вид даже при недопустимом новом виде. `renderFrame` требует точные `sceneRevision`, `viewRevision`, `sessionEpoch`, отдаёт `stale` или `aborted` без публикации кадра. Canvas рисуется сначала во временном буфере, а `drawImage` на публичный Canvas выполняется **после финальной проверки epoch/AbortSignal**. `dispose` идемпотентен, запрещает дальнейшие вызовы; `recoverDevice` для Canvas честно возвращает `E_SESSION_BACKEND_UNSUPPORTED`.

`preferredBackend: "webgpu"` вместе с `fallbackPolicy: "reject"` отклоняется, без имитации GPU. Только `allow-diagnostic` допускает явно названный Canvas2D fallback. Не заявлены поддержка WebGPU, восстановление device loss, графическая GPU-паритетность, реальная инкрементальность или совместный consumer Studio + game.

## 4. Доказательства и критерии дальнейшего допуска

- Компиляция нового runtime TypeScript по `runtime/tsconfig.json` с `strict:true` и существующим типовым контрактом.
- `tests/renderer-session.test.mjs`: синтетическая цельная 2×1 геометрия с 10 наружными гранями; фактические SHA, immutable copy, stale/abort/dispose, fail-closed ошибки digest/length/format/binding, C04, SharedArrayBuffer, геометрический cache key.
- `tests/renderer-session.browser.mjs`: Chromium, реальный Canvas2D, отдельное неподдерживаемое WebGPU, готовая двухклеточная mesh, пиксельный smoke, stale/cancel и плохой digest.
- Новый CI проверяет тесты, но **не утверждает**, что браузерный тест целиком выполняет принятый C++20 `BuildWholeObject`: его выход является заранее подготовленной synthetic mesh. Паритет этого exact GPU/Canvas backend с whole-object WASM — отдельный gate S3-S2B.
- Действующий Pages workflow не изменяется и не публикует runtime-модуль. Canvas2D публичной Studio остаётся действующим fallback. Не включать новые модули в существующую сборку до отдельного решения.

## 5. Следующий срез и не закрытые ограничения

**S3-S2B:** фактическая передача `model.fgm.json` + `preview.obj`, полученных из **реального** принятого WASM `BuildWholeObject`, в `RendererSession`, точная проверка паритета и переключение отдельного тестового интерфейса, затем WebGPU capability-gated backend и тесты потери устройства. Сохраняются прежние P3: предельные 8 клеток/49 152 C05, происхождение B1/R03 и дублированный Core SHA. Отдельный процессный долг Pages synchronize — [план Platform](https://github.com/netkeep80/fgm-platform/issues/15).