# EPROM CRM

Samodzielny CRM dla zespołu: pracownicy i role, firmy, zadania pojedyncze i cykliczne, planer dnia, urlopy, kalendarz, widoczne powiadomienia oraz własny komunikator CRM z rozmowami prywatnymi i grupowymi.

Projekt ma własny serwer, bazę SQLite i konfigurację wdrożenia. Nie korzysta z kodu, danych, serwera ani ustawień wcześniejszego komunikatora.

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
3. Umieść poświadczenie dedykowanego tunelu `eprom-crm` w prywatnym pliku `secrets/eprom-crm.json`.
4. Tunel korzysta z `cloudflared.docker.yml` i kieruje wyłącznie `crm.webspanner.pl` do usługi `http://crm:4310`.
5. Uruchom `START-CRM-DOCKER.cmd` albo:

```powershell
docker compose up -d --build
```

Stack publikuje podgląd lokalny tylko na `127.0.0.1:4320`. Publiczny ruch przechodzi przez Cloudflare Tunnel, dlatego router nie wymaga stałego IP ani otwierania portów przychodzących. Dane pozostają w `data`.

## Awaryjny start bez kontenera

Podpisana binarka `tools/cloudflared.exe` i plik poświadczenia tunelu nie są przechowywane w Git. Na przygotowanym komputerze można uruchomić `START-CRM-PUBLIC.cmd`; skrypt uruchamia CRM na `127.0.0.1:4320`, używa `cloudflared.host.yml` i utrzymuje tunel w tym samym oknie.

Obie konfiguracje wskazują wyłącznie nowy tunel `eprom-crm` (`b3876616-07e7-4f87-a646-301c43af1776`). Nie korzystają z tunelu ani ustawień komunikatora.

Nie uruchamiaj jednocześnie wariantu natywnego i kontenera, ponieważ oba zapisywałyby tę samą bazę SQLite.

## Zakres uprawnień

- administrator zarządza pracownikami, rangami, firmami i zadaniami oraz rozpatruje wszystkie urlopy;
- dyrektor rozpatruje urlopy innych osób;
- pracownik widzi przypisane firmy i zadania, otrzymuje aktualizacje oraz układa własny plan dnia;
- każdy aktywny pracownik może prowadzić rozmowy prywatne i grupowe w komunikatorze CRM;
- rodzaj urlopu jest wymagany;
- cykliczne zadania materializują kolejne terminy bez duplikatów;
- firmy i zadania są archiwizowane, aby zachować historię.

## Kontrola jakości

```powershell
npm test
npm run build
docker compose config --quiet
```

Testy obejmują migrację danych, uprawnienia urlopowe, rodzaje urlopu, serie cykliczne, strefę Europe/Warsaw, ochronę planów pracowników oraz dostarczanie i odczyt wiadomości.

## Git i Vercel

Repozytorium celowo nie zawiera `.env`, tokenu tunelu ani prawdziwej bazy. Obecnego backendu SQLite nie należy uruchamiać bezpośrednio jako funkcji Vercel, ponieważ środowisko Vercel nie zapewnia trwałego dysku dla takiej bazy. W pełni działający wariant korzysta z Docker + Cloudflare Tunnel; Vercel może później hostować frontend po przeniesieniu API do trwałej usługi lub zewnętrznej bazy.

## Kopie zapasowe

Przed aktualizacją zatrzymaj stack, skopiuj folder `data`, a następnie uruchom stack ponownie.
