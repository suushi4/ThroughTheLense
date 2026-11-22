# Звуки места: источники и лицензии

Петли из таблицы ниже сделаны из записей с лицензией **CC0 1.0** (общественное достояние, без условий атрибуции). Лицензия проверена по метаданным файла в Wikimedia Commons 21.11.2026. Авторы указаны из уважения к их работе, хотя CC0 этого не требует.

Обработка: `scripts/make-ambience-loop.sh` (28 секунд из указанного места, бесшовная петля с кроссфейдом 3 с, громкость −28 LUFS, MP3 64 кбит/с).

| Файл | Звук | Исходная запись | Автор | Лицензия | Фрагмент |
| --- | --- | --- | --- | --- | --- |
| `rain.mp3` | Дождь | [Light Rain Distant Thunder July 5th 2016.wav](https://commons.wikimedia.org/wiki/File%3ALight_Rain_Distant_Thunder_July_5th_2016.wav) ([оригинал на Freesound](https://freesound.org/people/kvgarlic/sounds/349454/)) | kvgarlic | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 50 с |
| `wet-asphalt.mp3` | Мокрый асфальт | [Urban Street on a Rainy Afternoon.flac](https://commons.wikimedia.org/wiki/File%3AUrban_Street_on_a_Rainy_Afternoon.flac) | Extemporalist | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 36 с |
| `street-traffic.mp3` | Улица | [Sagetyrtle - citystreet3 (cc0) (freesound).mp3](https://commons.wikimedia.org/wiki/File%3ASagetyrtle_-_citystreet3_%28cc0%29_%28freesound%29.mp3) | sagetyrtle | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 89 с |
| `park-birds.mp3` | Птицы в парке | [Réveil des oiseaux.ogg](https://commons.wikimedia.org/wiki/File%3AR%C3%A9veil_des_oiseaux.ogg) | Joseph Sardin | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 79 с |
| `crowd-talk.mp3` | Голоса людей | [Sunday in the center of Mexico City (close to Alameda Park), Schoeps MS Setup.flac](https://commons.wikimedia.org/wiki/File%3ASunday_in_the_center_of_Mexico_City_%28close_to_Alameda_Park%29%2C_Schoeps_MS_Setup.flac) ([оригинал на Freesound](https://freesound.org/people/felix.blume/sounds/260547/)) | Felix Blume | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 45 с |
| `cafe.mp3` | Кафе | [Cafe ambiance.ogg](https://commons.wikimedia.org/wiki/File%3ACafe_ambiance.ogg) | Marble Toast | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 202 с |
| `wind.mp3` | Ветер | [Howling wind.ogg](https://commons.wikimedia.org/wiki/File%3AHowling_wind.ogg) | Tvabutzku1234 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 96 с |
| `indoor-quiet.mp3` | Часы в тихой комнате | [Tick2.ogg](https://commons.wikimedia.org/wiki/File%3ATick2.ogg) | Marble Toast | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 27 с |
| `stream.mp3` | Ручей | [Snowmelt flowing into lake at Okanagan Mountain Provincial Park.flac](https://commons.wikimedia.org/wiki/File%3ASnowmelt_flowing_into_lake_at_Okanagan_Mountain_Provincial_Park.flac) | Extemporalist | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | с 30 с |

Не взята запись «442697-SBssa-Crowd Talking 003.wav»: в Commons она помечена CC0, но загружена как файл коммерческой библиотеки SoundSnap, и такая метка вызывает сомнения. Для голосов людей взята запись площади в Мехико от Felix Blume.

## Звуки, синтезированные для дневника

`sea.mp3`, `night-crickets.mp3`, `campfire.mp3` и `train.mp3` созданы для ThroughTheLense из шумовых и тональных сигналов без сторонних записей. Это звуковые имитации, их можно использовать в сценах и копиях дня.

## Ещё не добавлены

Для этих звуков в Commons не нашлось подходящих CC0-записей, а Freesound закрыт для автоматической загрузки. Поиск ниже уже отфильтрован по лицензии CC0:

| Звук | id | Поиск на Freesound (только CC0) |
| --- | --- | --- |
| Велосипед | `bicycle` | <https://freesound.org/search/?q=bicycle+riding&f=license%3A%22Creative+Commons+0%22> |
| Ночной город | `city-night` | <https://freesound.org/search/?q=city+night+ambience&f=license%3A%22Creative+Commons+0%22> |

Как добавить: скачайте запись (лучше 1–3 минуты ровного звука, без голосов крупным планом), выполните `scripts/make-ambience-loop.sh ~/Downloads/<файл> web/media/ambience/<id>.mp3 <секунда начала>`, впишите строку в таблицу выше со ссылкой на страницу звука и автором и добавьте запись с `id` в `ambienceLibrary` в `web/ambience.mjs`.
