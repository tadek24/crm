# EPROM CRM

Samodzielny CRM dla zespołu: pracownicy i role, firmy, zadania pojedyncze i cykliczne, planer dnia, urlopy, kalendarz oraz widoczne powiadomienia.

Projekt ma własny serwer, bazę SQLite i konfigurację wdrożenia. Nie korzysta z kodu, danych, serwera ani ustawień komunikatora.

## Uruchomienie lokalne

```powershell
npm ci
npm run build
npm start
```

Domyślny adres serwera to `http://127.0.0.1:4310`. Dane są zapisywane w `data/crm.sqlite`.

## Uruchomienie w Dockerze

1. Skopiuj `.env.example` do prywatnego pliku `.env`.
2. Ustaw w nim długi, losowy `CRM_SETUP_TOKEN`.
3. Utwórz plik `secrets/cloudflare-tunnel-token` z tokenem dedykowanego tunelu `eprom-crm`.
4. W Cloudflare ustaw trasę `crm.webspanner.pl` do usługi `http://crm:4310`.
5. Uruchom `START-CRM-DOCKER.cmd` albo:

```powershell
docker compose up -d --build
```

Stack publikuje podgląd lokalny tylko na `127.0.0.1:4320`. Publiczny ruch przechodzi przez Cloudflare Tunnel, dlatego router nie wymaga stałego IP ani otwierania portów przychodzących. Dane pozostają w `data`.

## Awaryjny start bez kontenera

Podpisana binarka `tools/cloudflared.exe` i plik tokenu nie są przechowywane w Git. Na przygotowanym komputerze można uruchomić `START-CRM-PUBLIC.cmd`; skrypt uruchamia CRM na `127.0.0.1:4320` i tunel w jednym oknie.

Nie uruchamiaj jednocześnie wariantu natywnego i kontenera, ponieważ oba zapisywałyby tę samą bazę SQLite.

## Zakres uprawnień

- administrator zarządza pracownikami, rangami, firmami i zadaniami oraz rozpatruje wszystkie urlopy;
- dyrektor rozpatruje urlopy innych osób;
- pracownik widzi przypisane firmy i zadania, otrzymuje aktualizacje oraz układa własny plan dnia;
- rodzaj urlopu jest wymagany;
- cykliczne zadania materializują kolejne terminy bez duplikatów;
- firmy i zadania są archiwizowane, aby zachować historię.

## Kontrola jakości

```powershell
npm test
npm run build
docker compose config --quiet
```

Testy obejmują migrację danych, uprawnienia urlopowe, rodzaje urlopu, serie cykliczne, strefę Europe/Warsaw i ochronę planów pracowników.

## Git i Vercel

Repozytorium celowo nie zawiera `.env`, tokenu tunelu ani prawdziwej bazy. Obecnego backendu SQLite nie należy uruchamiać bezpośrednio jako funkcji Vercel, ponieważ środowisko Vercel nie zapewnia trwałego dysku dla takiej bazy. W pełni działający wariant korzysta z Docker + Cloudflare Tunnel; Vercel może później hostować frontend po przeniesieniu API do trwałej usługi lub zewnętrznej bazy.

## Kopie zapasowe

Przed aktualizacją zatrzymaj stack, skopiuj folder `data`, a następnie uruchom stack ponownie.
