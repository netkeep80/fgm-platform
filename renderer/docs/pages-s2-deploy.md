# PAGES-S2 — явное развёртывание принятой камеры через GitHub Actions

## Основание

Принятый PAGES-S1 перенёс проверенную синтетическую браузерную камеру V03-S3 в ветку `gh-pages`. Последний принятый `main` перед PAGES-S2 — `6e823a63714f92fb0d00a9c65e63d2c43a7d92b1`; текущий опубликованный в ветке HEAD — `29d9ed509c5ef50e3a92b8bb72db10eb7903069f`, TREE — `5cfaed61445bd4cd460d974cbcea7aea7ad07c75`. Дерево содержит девять авторских web-файлов и пустую `.nojekyll`. Новый Pages build после staging не появился; последняя подтверждённая публикация — старая V01.

## Административная граница

**Перед слиянием PAGES-S2** необходимо подтвердить в `Settings → Pages → Build and deployment`, что `Source = GitHub Actions`, а не `Deploy from a branch`. Добавление workflow само по себе не изменяет настройки источника. Подключение GitHub, используемое для разработки, не предоставляет операции изменения Pages settings. Если Source остался branch, `actions/deploy-pages` может отказать при публикации из main.

## Строгий выпуск

Исторический `.github/workflows/deploy-v03-s3.yml` запускался через `workflow_dispatch` или один раз при слиянии изменения самого workflow в `main`. Для последующего восстановления V03 предусмотрен [единый workflow Studio Pages](studio-pages.md).

Задание `verify` с `contents:read` выполняет checkout текущего main и **точного коммита** из `gh-pages`, проверяет происхождение main, неотклонение текущего ref, точные HEAD/TREE, имена и типы десяти Git-записей, чистоту worktree и SHA-256 каждого из девяти web-файлов. Негативные тесты `tests/test_pages_snapshot.py` подтверждают отказ при подменах, лишних файлах и symlink. `actions/upload-pages-artifact` создаёт публикационный архив только из проверенного каталога. Скрытая `.nojekyll` не попадает в стандартный Pages artifact, однако её тип и пустое содержимое проверены; остальные девять файлов неизменны.

Задание `deploy` с правами только `pages:write` и `id-token:write`, в окружении `github-pages`, вызывает официальный `actions/deploy-pages`. Ни одно задание не меняет `main` или `gh-pages`, не загружает игровые ресурсы и не пересобирает C++/WASM. Нормативное `FGMV-PUB-002` остаётся кандидатом.

## Критерии окончательного результата

Только успешная работа `deploy-pages` и отдельное свидетельство GitHub Pages deployment допускают переход к проверке публичного сайта. После этого необходимо подтвердить HTTP и содержимое `index.html`, `camera.html`, `camera.js`, `fgm_scene.wasm`, а затем работоспособность управления камерой в WebGPU-браузере. Автоматические тесты Chromium/SwiftShader не являются свидетельством аппаратной совместимости.

До этого разграничивать состояния `STAGED` и `DEPLOYED`. Ошибки Permissions, Environment, Pages Source, доступа к файлам или изменения SHA являются блокирующими. Никакой игровой picking, Fog-of-War, 4K-оптимизации, V04 или новой семантической модели здесь нет.

Перед merge обязательны exact BASE/HEAD/TREE, RepoGuard v6.0.1, отдельный adversarial PASS и явная авторская приёмка. История изменений и свидетельства хранятся в [Issue #21](https://github.com/netkeep80/fgm-renderer/issues/21).
