# Текущий линейный этап — R06-ABI-S2B

Принятый [PR #45](https://github.com/netkeep80/fgm-regenerator/pull/45) добавил общий C++20 сборщик целого объекта. Основа S43-S2B — `main` `91a9edae78c5782463de6d9f5501553c86b253b2`, дерево `32508f8aeaf350177060bdb161350675122c1455`. [Слияние и план](https://github.com/netkeep80/fgm-regenerator/issues/43#issuecomment-6919297817).

Активная задача [Regenerator #43](https://github.com/netkeep80/fgm-regenerator/issues/43) подключает сборщик к native Studio и браузерному WASM Worker. [Контракт S43-S2B](r06-abi-s2b-worker.md) задаёт входы, лимиты, жизненный цикл и выгрузку.

После приёмки S43-S2B следующий этап — [Renderer #38](https://github.com/netkeep80/fgm-renderer/issues/38), подключение браузерной сборки к интерфейсу Reconstruction Studio и публикация через GitHub Pages.
