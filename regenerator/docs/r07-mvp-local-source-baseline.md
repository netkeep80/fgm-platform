# R07-EARLY-MVP — S0: локальное исходное наблюдение и честный baseline

**Статус:** кандидат `FGMR-R07-LOCAL-001`, `accepted:false / current:false / published:false`. Первый технический срез задачи [план Platform](https://github.com/netkeep80/fgm-platform/issues/11). **Не завершает R07-EARLY-MVP:** ещё нет оптимизации параметров по исходному спрайту, независимой аттестации целой ObjectDefinition и четырёх новых видов.

## Назначение

`r07_local_observation.py` принимает заранее выбранную пользователем **локальную** связку источников: MAP, упорядоченные MCD всех наборов карты, LOFTEMPS.DAT, PCK/TAB выбранного набора и соответствующую палитру. Скрипт проверяет SHA-256 исходных байтов, ограничивает объём данных, затем вызывает **принятый C++20 `fgmr-studio-native`** с алгоритмом `r06-cell/1`. Он не дублирует в Python декодер R04, математику камеры R05, разбор MCD/MAP, построение LOFT или нормативную проверку C05.

Из пяти нативных результатов (`model`, `preview`, `report`, `proof`, `visual`) проверяются точные SHA-256, источник выбранной записи, координатный кадр, число C05-сэмплов (6144), исходные наборы и совпадение счётчиков пиксельных масок. По собственным **готовым** R05-координатам только вычисляются две диагностические метрики:

~~~math
IoU = \frac{|P\cap O|}{|P\cup O|}, \qquad
ContourL_1 = \sum_{p\in\partial P}\min_{q\in\partial O}\|p-q\|_1 + \sum_{q\in\partial O}\min_{p\in\partial P}\|q-p\|_1.
~~~

Если маска пуста, метрика отмечается `null`, а не выдуманным совпадением. Контурная метрика намеренно не нормирована на длину границы. `P` — предсказанная R05-маска LOFT, `O` — наблюдаемая R05-маска спрайта, **не** проекция новой оптимизированной FGM-поверхности. Эти baseline-метрики нельзя выдавать за R07-fit или успех экспериментальной аппроксимации.

## Локальный запуск

После обычной native CMake-сборки подготовьте **на своей машине** файл `selection.json` по схеме `fgmr-r07-local-selection/1`:

```json
{
  "schema": "fgmr-r07-local-selection/1",
  "object_key": "my-hypothesis-001",
  "membership": {"status": "hypothesis", "evidence_note": "Требует проверки ObjectDefinition"},
  "expected_source": {"dataset_label": "SELECTED", "local_index": 0, "part": "object"},
  "files": {
    "map": {"path": "LOCAL.MAP", "sha256": "<SHA256>"},
    "loft": {"path": "LOFTEMPS.DAT", "sha256": "<SHA256>"},
    "ds0": {"path": "FIRST.MCD", "sha256": "<SHA256>"},
    "ds1": {"path": "SELECTED.MCD", "sha256": "<SHA256>"},
    "pck": {"path": "SELECTED.PCK", "sha256": "<SHA256>"},
    "tab": {"path": "SELECTED.TAB", "sha256": "<SHA256>"},
    "palette": {"path": "PALETTES.DAT", "sha256": "<SHA256>"}
  },
  "spec": {
    "algorithm": "r06-cell/1",
    "coreRevision": "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b",
    "budget": 6144,
    "sourceBindings": {
      "map": "map", "loft": "loft",
      "datasets": [{"id": "FIRST", "file": "ds0"}, {"id": "SELECTED", "file": "ds1"}],
      "sprite": {"dataset": "SELECTED", "pck": "pck", "tab": "tab", "palette": "palette"}
    },
    "parameters": {"tile": [0, 0, 0], "part": "object", "material": "stone",
                   "frameSlot": 0, "tabBits": 16, "paletteIndex": 4}
  }
}
```

Этот пример **только структура**, не достоверный набор/карта и не готовая конфигурация реального UFO. `map`, `datasets`, `tile`, `part`, `paletteIndex` и `frameSlot` должны быть взяты из предварительно проверенного локального каталога, а не угаданы. Для SHA можно использовать стандартный `sha256sum` либо локальный `hashlib.sha256`. Пути могут быть относительными каталогу `selection.json`. Исходные файлы должны быть обычными файлами без символьных ссылок. Переданное имя `object_key` — **гипотеза/локальный ключ**, не удостоверенная модель.

```sh
python scripts/r07_local_observation.py \
  --manifest /PRIVATE/selection.json \
  --native build/fgmr-studio-native \
  --output /PRIVATE/r07-observation-001
```

На Windows путь к исполняемому файлу обычно `build/Release/fgmr-studio-native.exe`. Каталог результата **не должен существовать** до запуска; никакие существующие результаты не перезаписываются. При отказе нет успешного выходного каталога; диагностический код не выводит исходные байты. Не коммитьте `selection.json`, локальные PCK/TAB/MCD/LOFT, полученные `model.fgm.json` и `preview.obj`, `visual.json`, `report.json` или личные пути.

## Что именно доказано и что НЕ доказано

- **Доказано при успешном локальном запуске:** выбранная часть MAP ссылается на заявленные MCD dataset/local_index; нативный R04 разобрал кадры выбранной записи, нативный R05 сформировал наблюдаемую/предсказанную маски в `r05-ufo-dimetric/1`; нативный C05 совпал с исходной LOFT-занятостью на 6144 пробах; все возвращённые файлы привязаны SHA.
- **Не доказано:** что эта часть карты — целая `ObjectDefinition`; что кадры представляют разные ракурсы, а не анимационные состояния; что hidden faces восстановлены; что параметры FGM улучшены относительно baseline; что исходные пакеты прошли стороннюю историческую аттестацию.
- **Намеренное ограничение S0:** всегда возвращает `stage_a=BASELINE_ONLY_NOT_FITTED` и `object_identity=NOT_INDEPENDENTLY_ATTESTED`, даже при `membership.status=explicit`. Результат является **локальным исследовательским свидетельством**, а не подтверждением полного DoD задачи #50.

Следующий срез S1 использует эти честные baseline-артефакты и выбранный локальный `ObjectDefinition` для ограниченного поиска параметров `θ` в существующей FGM-грамматике при неизменных gameplay hard-gates. Требуется отклонять нулевое/отрицательное улучшение и неподтверждённую принадлежность, затем строить четыре дополнительные 3D-проекции в RV01. Срезы выполняются последовательно, с отдельным независимым READ-ONLY аудитом каждого точного HEAD/TREE.

## Проверки

`ctest -R r07-local-source-baseline` на Linux/Windows создаёт исключительно синтетические PCK/TAB/палитру/MCD/MAP/LOFT в системном временном каталоге, запускает реальный `fgmr-studio-native` и проверяет отрицательные случаи: SHA mismatch, неправильная MCD identity, испорченный PCK, неверная привязка dataset, симлинк, повторная запись и отсутствующий файл. Никаких оригинальных ресурсов UFO в репозитории или CI нет.