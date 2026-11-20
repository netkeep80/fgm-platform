# Выпуск и проверка Platform Studio

Один root workflow `.github/workflows/platform.yml` проверяет Platform и публикует тот же готовый пакет.
Четыре обязательных verification jobs: RepoGuard, native Ubuntu, native Windows и реальный WASM/WebGPU/Chromium. Единственный дополнительный release job работает только на main после их успеха.
PR получает read permissions и review artifact. Наличие этого workflow не доказывает успешной live-публикации:
каждая новая публикация подтверждается отдельно по production CI, публичным SHA/TREE/hashes и настоящему WASM/Chromium smoke; ручные recovery/failure drills имеют самостоятельные свидетельства.
[Корневая инструкция](../../docs/platform.md) содержит одну процедуру native/WASM сборки.

## Один пакет и точная ревизия

После root WASM build запустите из корня:

    node renderer/scripts/build-studio-s2a.mjs build/wasm
    cd renderer
    python -m scripts.studio_pages studio build/studio build/pages-studio --revision FULL_PLATFORM_SHA > build/pages-hashes.json
    python -m scripts.studio_pages verify build/pages-studio --revision FULL_PLATFORM_SHA --hashes build/pages-hashes.json

FULL_PLATFORM_SHA — полный SHA текущего Platform коммита. Producer проверяет чистый tracked checkout
и build metadata. Publisher независимо получает настоящий Git TREE указанного коммита, его engine contract
и версию A.M. Другой TREE отвергается, даже если все активы заново хэшированы.
Входной schema — fgmp-studio-bundle/1, готовый сайт — fgmp-studio-pages/1.

A хранится в renderer/studio/architecture-version.txt в целевом коммите. M — число merge-коммитов
по первым родителям до этой ревизии. Для PR review явно передаётся --preview-base FULL_BASE_SHA:
M равен числу merge-коммитов BASE плюс один. Preview не допускается как release/rollback.
SHA и TREE находятся в публичном manifest и подсказке версии.

Validator проверяет девять активов и manifest: точные имена, обычные файлы, отсутствие symlink,
суммарный размер до 16 MiB, WASM magic, engine, version badge и SHA-256.
Переданные --hashes должны охватывать все десять файлов, включая manifest.
Локальный файл hashes подтверждает соответствие байтам; production admission получает ожидания из CI.

## Доверенное происхождение и публикация

WASM/browser job упаковывает уже проверенный сайт в deterministic studio.zip с release.json:
полный hash index, repository ID, source SHA/TREE, версия. Этот ZIP загружается один раз как
immutable Actions artifact с именем platform-studio-FULL_SHA-ATTEMPT.
Release job получает его по точному artifact ID текущего run/attempt, независимо сверяет provider digest,
repository ID, main ref, source SHA, workflow path и четыре успешных обязательных verification jobs этого же attempt.
Только после этого ZIP раскрывается через существующий validator. Другая сборка ради публикации не нужна.

Каждый push в принятый main, включая изменения только документации или CI, запускает все обязательные проверки и автоматическую публикацию без path filters. Для явного повторного выпуска используется
workflow_dispatch на main: mode=publish, expected_main=FULL_CURRENT_MAIN_SHA.
Текущий main проверяется через GitHub API при входе и перед заменой Pages; stale запуск отвергается.
Привилегии contents/pages/attestations/id-token ограничены release job, общая concurrency не прерывает
уже идущую публикацию. Перед заменой сайта предыдущий release скачивается и аутентифицируется для fallback.

После Pages deploy общий HTTP/Chromium checker должен подтвердить именно загруженные байты и настоящий WASM.
Лишь затем actions/attest подписывает ZIP, а закреплённый gh CLI проверяет подпись и сохраняет ZIP вместе с
studio.sigstore.json в обычный GitHub Release studio-FULL_SOURCE_SHA. Release становится latest только после
проверки сохранённых байтов. Существующие принятые assets не перезаписываются.
Существующий Draft до загрузки assets обязан иметь target_commitish, равный полному ожидаемому SHA;
плавающая ветка или другой commit отвергаются без изменения Release. Уже существующий tag проверяется
до загрузки, а отсутствие tag допустимо только для Draft. Ошибки API не считаются отсутствующим tag.
Metadata и tag повторно читаются непосредственно перед публикацией; проверка после публикации сохраняется.
Неопубликованный GitHub Draft без созданного Git tag нельзя читать через REST `releases/tags/<tag>`:
адаптер ищет единственный точный tag в списке Releases и затем перечитывает release по provider ID.
ID, `target_commitish`, признак Draft и tag проверяются до загрузки и повторно непосредственно перед
публикацией, включая восстановление после частично созданного Draft. Пустой или конфликтующий Git tag
не разрешает переадресовать Draft на другой коммит; остальные ошибки GitHub API блокируют выпуск.
Сразу после успешного создания нового Draft REST-список GitHub может обновиться с задержкой.
Поэтому только отсутствие нового Draft повторно читается ограниченное число раз (максимум 12 чтений
с паузами по 2 секунды). Ошибка API, конфликт идентичности и неправильный target не повторяются;
новый Draft повторно не создаётся. Уже существующий Draft используется без ожидания.
Текущий и предыдущий продуктовые releases остаются доступны; полный исторический архив не требуется.

## Откат и автоматическое восстановление

Для production rollback запускается тот же workflow на main: mode=rollback,
Параметры: expected_main=FULL_CURRENT_MAIN_SHA, release_revision=FULL_PREVIOUS_RELEASE_SHA.
Сборка пропускается: используются десять исходных файлов сохранённого продукта без изменения.
Тот же adapter можно применить для независимого admission без публикации, из renderer:

    python -m scripts.studio_release restore --revision FULL_RELEASE_SHA --output build/checked-release/site

Нужны authenticated gh, закреплённый CI verifier gh 2.105.0 и полный Platform checkout.
CLI берёт release только из netkeep80/fgm-platform с фиксированным repository ID, требует stable release,
точный lightweight tag→commit, provider digests обоих assets и подписанный ZIP.
Подпись проверяется для ожидаемого repository/workflow, refs/heads/main, source/signer SHA и GitHub-hosted runner;
verified statement обязан содержать SHA-256 именно данного ZIP. Затем validator сверяет Git TREE/engine/version
и все десять hashes. Непроверенный архив не записывается в output, произвольный файл --hashes не даёт допуска.
После rollback public smoke повторяется, а восстановленный release становится latest.

Если новая публикация, public smoke или сохранение release завершается ошибкой после попытки deploy,
pipeline восстанавливает заранее аутентифицированный предыдущий сайт и повторяет public smoke.
Исходный job остаётся RED. Для первой публикации предыдущего Platform release ещё нет;
ошибка не превращается в успех и требует разбора фактического Pages состояния.

## HTTP и настоящий WASM smoke

renderer/tests/studio-pages.live.mjs проверяет https://netkeep80.github.io/fgm-platform/
и локальный review сервер по loopback HTTP. PAGES_REVISION, PAGES_VERSION и PAGES_HASHES поступают
из независимо допущенного пакета; PAGES_URL разрешает локальный review URL.
Production адрес ограничен указанным Platform HTTPS URL.

Checker получает каждый ресурс без redirect, сверяет hashes, schema, engine, настоящий Git SHA/TREE и badge.
Chromium повторно проверяет каждый HTTP ресурс до исполнения; подмена после scan блокируется.
Browser network boundary разрешает только GET к данному сайту и локальные blob/data.
Gzip сравнивается по распакованным байтам; при передаче Chromium сохраняются корректные MIME/security headers.
Настоящий WASM проверяет synthetic example, локальный синтетический BARN/CULTA00 catalog
и whole object на четыре клетки/24576 центров. Screenshot сохраняется для визуальной приёмки.

## Проверки и границы приёмки

Из renderer:

    python -m unittest discover -s tests -p 'test_pages_*.py' -v
    python -m unittest discover -s tests -p test_studio_release.py -v
    node --test tests/studio-pages-live.test.mjs

Native Ubuntu/Windows исполняют publisher, origin/ZIP/rollback и HTTP negatives.
Ubuntu WASM job дополнительно запускает настоящий закреплённый gh attestation verifier против unsigned bundle,
Chromium smoke и подмену ответа после scan. Тестовые verifier fixtures проверяют отрицательные сценарии admission/control flow, но не заменяют
положительную проверку подписи и реальной публикации. Для Studio 1.12–1.15 уже зафиксированы
подписанные продуктовые Releases и успешные публичные HTTP/WASM проверки; [подтверждённый выпуск Studio 1.15](https://github.com/netkeep80/fgm-platform/releases/tag/studio-d8e46463f282109f0ff15ee9fef71b192d49600f)
подтверждён [production run #44623246908](https://github.com/netkeep80/fgm-platform/actions/runs/44623246908).
Отдельно подтверждён [ручной откат на подписанную Studio 1.12](https://github.com/netkeep80/fgm-platform/issues/1#issuecomment-7019384340).
Дополнительные ручные failure/fallback drills отложены автором до завершения миграции и не являются её блокером.

Положительный live-выпуск Platform и удаление прежнего вложенного
`renderer/.github/workflows/studio-pages.yml` подтверждены в принятом S08 PR #43. Единственный действующий
workflow публикации — `.github/workflows/platform.yml` в корне монорепозитория.
Зелёный PR CI не означает PUBLISHED: для каждого merge проверяются production deploy, HTTP hashes и реальный WASM.
Финальные FUNCTIONAL/INDEPENDENCE/REQUIREMENTS/SIMPLIFICATION_PASS требуют отдельного независимого аудита
и авторской приёмки. Stage A, browser R07 fit, физические GPU/Windows WebGPU и универсальная корректность
всех FGM моделей не выводятся из этих технических проверок.
