# Треки дневника: источники и лицензии

Десять треков в `web/media/music/` предлагаются в редакторе в разделе «Нет своей песни? Возьмите трек из дневника», вместе с тремя треками примеров. Все исходные записи опубликованы с лицензией **CC0 1.0** (общественное достояние) некоммерческим проектом Musopen в Wikimedia Commons. Лицензия проверена по метаданным каждого файла 21.11.2026. Сами произведения давно перешли в общественное достояние. Исполнители указаны там, где они есть в метаданных.

Обработка: `scripts/make-track-excerpt.sh` (фрагмент с указанной секунды, появление 0,3 с, затухание 2 с, громкость −18 LUFS как у треков примеров, MP3 128 кбит/с с постоянным битрейтом).

| Файл | В редакторе | Произведение | Исполнитель в источнике | Исходная запись | Лицензия | Фрагмент |
| --- | --- | --- | --- | --- | --- | --- |
| `morning-light.mp3` | Утренний свет | И. С. Бах, «Jesu bleibet meine Freude», BWV 147 | Orchestra Gli Armonici | [Bach, BWV 147, 10. Jesus bleibet meine Freude.ogg](https://commons.wikimedia.org/wiki/File%3ABach%2C_BWV_147%2C_10._Jesus_bleibet_meine_Freude.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `light-steps.mp3` | Лёгкие шаги | И. С. Бах, Сюита № 2 си минор, Badinerie | European Archive | [Bach, Johann Sebastian - Suite No.2 in B Minor - X. Badinerie.ogg](https://commons.wikimedia.org/wiki/File%3ABach%2C_Johann_Sebastian_-_Suite_No.2_in_B_Minor_-_X._Badinerie.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `long-look.mp3` | Долгий взгляд | Т. Альбинони, Концерт для гобоя ре минор, op. 9 № 2, II | не указан | [Albinoni, Concerto for Oboe and Strings No. 2 in D minor, Op. 9, II. Adagio.ogg](https://commons.wikimedia.org/wiki/File%3AAlbinoni%2C_Concerto_for_Oboe_and_Strings_No._2_in_D_minor%2C_Op._9%2C_II._Adagio.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `night-talk.mp3` | Ночной разговор | Ф. Шопен, Ноктюрн ми-бемоль мажор, op. 9 № 2 | Peter Johnston | [Chopin Nocturne No. 2 in E Flat Major, Op. 9.ogg](https://commons.wikimedia.org/wiki/File%3AChopin_Nocturne_No._2_in_E_Flat_Major%2C_Op._9.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `last-waltz.mp3` | Последний вальс | Ф. Шопен, Вальс до-диез минор, op. 64 № 2 | Frédéric Chopin | [Chopin-waltz-op-64-no-2-in-c-sharp-minor.oga](https://commons.wikimedia.org/wiki/File%3AChopin-waltz-op-64-no-2-in-c-sharp-minor.oga) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `room-dance.mp3` | Танец в комнате | Э. Григ, «Пер Гюнт», «Танец Анитры» | Musopen Symphony Orchestra | [Grieg, Peer Gynt Suite No. 1, Op. 46 - III. Anitra's Dance.ogg](https://commons.wikimedia.org/wiki/File%3AGrieg%2C_Peer_Gynt_Suite_No._1%2C_Op._46_-_III._Anitra%27s_Dance.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `steppe-road.mp3` | Дорога в степи | А. Бородин, «В Средней Азии» | Musopen Symphony Orchestra | [Alexander Borodin - In The Steppes Of Central Asia.ogg](https://commons.wikimedia.org/wiki/File%3AAlexander_Borodin_-_In_The_Steppes_Of_Central_Asia.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 20–60 с |
| `quiet-comfort.mp3` | Тихое утешение | Л. ван Бетховен, Соната № 8 «Патетическая», II | Ludwig van Beethoven | [Beethoven, Sonata No. 8 in C Minor Pathetique, Op. 13 - II. Adagio cantabile.ogg](https://commons.wikimedia.org/wiki/File%3ABeethoven%2C_Sonata_No._8_in_C_Minor_Pathetique%2C_Op._13_-_II._Adagio_cantabile.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `square-festival.mp3` | Праздник на площади | Ж. Бизе, «Кармен», прелюдия к I акту | Musopen | [Carmen - Prelude to Act 1.ogg](https://commons.wikimedia.org/wiki/File%3ACarmen_-_Prelude_to_Act_1.ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–40 с |
| `wind-window.mp3` | Ветер в окно | Ф. Шопен, Прелюдия до мажор, op. 28 № 1 | Frederic Chopin | [Prelude Op. 28 no. 1.mp3](https://commons.wikimedia.org/wiki/File%3APrelude_Op._28_no._1.mp3) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 0–37 с |

Подсказка «подходит к фото» сравнивает теплоту обложки с полем `warmth` трека в `web/tracks.mjs`. Значения выставлены вручную по настроению пьесы на той же шкале, что у обложек: около 0,06 для холодных и тревожных, около 0,13 для светлых и праздничных.

## Оригинальные инструментальные фрагменты

В файлах `soft-morning.mp3`, `open-window.mp3`, `blue-hour.mp3`, `paper-lanterns.mp3`, `late-platform.mp3` и `beyond-hills.mp3` звучат мелодии и аккомпанемент, синтезированные для ThroughTheLense. Они не содержат сторонних записей или семплов и доступны для использования в сценах и копиях дня.
