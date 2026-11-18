# Подготовка и проверка Platform Studio

Текущий срез проверяет пакет до публикации. Production Pages ещё не подключён к Platform.
Исходники и WASM собираются из одного checkout по [корневой инструкции](../../docs/platform.md).
Последний dormant Pages workflow заменяется следующим срезом S07; его старые команды не являются текущей процедурой.

## Один пакет и точная ревизия

После root WASM build запустите из корня:

    node renderer/scripts/build-studio-s2a.mjs build/wasm
    cd renderer
    python -m scripts.studio_pages studio build/studio build/pages-studio --revision FULL_PLATFORM_SHA > build/pages-hashes.json
    python -m scripts.studio_pages verify build/pages-studio --revision FULL_PLATFORM_SHA --hashes build/pages-hashes.json

FULL_PLATFORM_SHA — полный SHA коммита текущей Platform. Producer проверяет чистый tracked checkout
и build metadata. Publisher независимо получает настоящий Git TREE указанного коммита, его engine contract
и версию A.M. Другой TREE отвергается, даже если это корректная 40-hex строка и все активы заново хэшированы.
Входной манифест имеет schema fgmp-studio-bundle/1, готовый сайт — fgmp-studio-pages/1.

A хранится в renderer/studio/architecture-version.txt в самом коммите. M — число merge-коммитов
по первым родителям до этой ревизии. Для review можно явно указать --preview-base FULL_BASE_SHA:
тогда M равен числу merge-коммитов BASE плюс один. Такой preview не подходит для rollback релиза.
SHA и TREE находятся в публичном manifest и подсказке версии.

Проверяются девять фиксированных активов и manifest: имена, обычный тип файла, отсутствие symlink,
ограничение общего размера 16 MiB, WASM magic, точный engine, version badge и SHA-256.
Verify повторно проверяет уже готовый сайт. Если передан --hashes, требуется совпадение всех десяти
хэшей, включая сам manifest. Наличие хэшей рядом с пакетом само по себе не удостоверяет его происхождение.

## Побайтовый Platform rollback

Откат использует ранее проверенный Platform сайт. Пересборка, старый V03, исходные репозитории и старый Pages не нужны.

    python -m scripts.studio_pages rollback VERIFIED_PLATFORM_SITE build/pages-restored --revision FULL_RELEASE_SHA --hashes TRUSTED_RELEASE_HASHES.json
    python -m scripts.studio_pages verify build/pages-restored --revision FULL_RELEASE_SHA --hashes TRUSTED_RELEASE_HASHES.json

TRUSTED_RELEASE_HASHES.json должен быть независимо получен от разрешённого ранее проверенного выпуска,
а не вычислен из потенциально повреждённого входа. Не допускаются неполные hashes или отсутствующий manifest hash.
Исходный Git commit должен присутствовать в Platform checkout: engine/version/TREE читаются из него,
даже если текущий HEAD уже продвинулся. Содержимое всех десяти файлов копируется без изменения.
Непустой output и пересечение output/input отвергаются до записи.

Эта команда проверяет admission. Она не подтверждает авторскую приёмку, успешный прежний deployment
или происхождение произвольно переданного файла hashes. Следующий срез S07 обязан связать rollback
с доверенным CI release artifact, сохранить необходимые текущие release материалы и реально проверить
развёртывание/откат без доступности старых репозиториев. Полный архив истории для этого не требуется.

## HTTP и настоящий WASM smoke

renderer/tests/studio-pages.live.mjs использует ту же проверку для будущего адреса
https://netkeep80.github.io/fgm-platform/ и локального review сервера по loopback HTTP.
Ему передаются PAGES_REVISION, PAGES_VERSION и PAGES_HASHES из независимо проверенного выпуска;
PAGES_URL задаёт локальный review URL. В production разрешён только указанный Platform HTTPS URL.

Checker получает каждый из десяти ресурсов без redirect, сверяет ожидаемые hashes, schema, engine,
точный Git revision/TREE и version badge. Chromium затем повторно проверяет hash каждого загружаемого
ресурса до исполнения. Подмена ответа после HTTP scan блокируется. Общая browser network boundary
разрешает только GET к данному сайту и локальные blob/data; внешний запрос отклоняется.
Gzip-ответы сравниваются по распакованным байтам пакета; при передаче проверенных байтов Chromium
сохраняет MIME/security headers и получает корректные encoding/length.

Настоящий WASM проверяет synthetic example, каталог из локальной синтетической папки BARN/CULTA00
и whole object на четыре клетки/24576 центров. Screenshot сохраняется как review evidence.
Успешный локальный HTTP smoke не означает PUBLISHED или визуальную авторскую приёмку.

## Проверки и оставшийся S07

Из renderer:

    python -m unittest discover -s tests -p test_studio_pages.py -v
    node --test tests/studio-pages-live.test.mjs

Native Ubuntu/Windows выполняют Git/TREE/rollback и реальные HTTP negatives.
Существующий Ubuntu WASM/browser job дополнительно передаёт STUDIO_REVIEW_SITE=build/pages-studio
тому же HTTP suite и выполняет настоящий Chromium smoke и подмену ответа после scan.
Нового workflow/job или CMake target нет.

S07 остаётся открытым до одной цепи accepted main → native/WASM → проверенный artifact → Pages,
доверенного rollback, public HTTP/browser smoke, удаления последнего legacy Pages workflow и отдельной
визуальной авторской приёмки. Несовместимые UI/API изменения требуют отдельной авторской приёмки.
Stage A, browser R07 fit, физические GPU/Windows WebGPU и финальные четыре PASS этим срезом не принимаются.
