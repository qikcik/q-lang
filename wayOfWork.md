# QLang — Zasady Pracy

> Filozofia i meta-zasady współpracy przy rozwoju projektu.  
> Konkrety (struktura plików, komendy, baseline testów) należą do innych `*.md`.

---

## 1. Źródło prawdy

Pliki `*.md` są zawsze ważniejsze niż pamięć.  
Przed każdą decyzją dotyczącą istniejącego kodu — najpierw przeczytaj, potem działaj.  
Pamięć może być nieaktualna. Kod i dokumentacja nigdy nie kłamią o tym, czym są _teraz_.

---

## 2. Podejście systemowe

Zmiany wprowadzamy systemowo — nie przez naiwne dopisywanie kodu na końcu.  
Każda nowa funkcjonalność przechodzi przez **cały** pipeline: od parsera, przez typechecker, aż po generację kodu, testy i dokumentację. Brakujące ogniwo to dług, który wróci.

Zanim napiszesz linię kodu — zapytaj: _gdzie w systemie to żyje i jak wpływa na resztę?_

---

## 3. Zasada Pareto (i podwójna Pareto)

Przy trudnych lub rozmytych wymaganiach: zaimplementuj 20% które pokrywa 80% przypadków.  
Dla szczególnie złożonych obszarów stosuj podwójną Pareto — wdrażaj minimum które działa, zostawiając **furtkę architektoniczną** na późniejsze doprecyzowanie.

Furtka architektoniczna to świadome miejsce w kodzie lub interfejsie, które można rozszerzyć bez burzenia istniejącej struktury. Nie jest to hack — to zaplanowana elastyczność.

---

## 4. Czystość architektury ponad lokalną kombinatoryką

Nie komplikuj lokalnie żeby uprościć globalnie. Jeśli fragment kodu obsługuje zbyt wiele przypadków naraz — to sygnał, że powinien zostać rozbity na mniejsze, czyste odpowiedzialności.

Preferencja: prosta architektura z jasnymi granicami między warstwami, nawet jeśli poszczególne warstwy są bardziej rozbudowane.

---

## 5. Limit rozmiaru pliku jako narzędzie projektowe

Twardy limit długości pliku to narzędzie wymuszające dobre decyzje architektoniczne.  
Gdy plik zbliża się do limitu — nie obchodź go. Zamiast tego zapytaj: _co tu jest zbyt splecione i powinno żyć osobno?_

Tworzenie nowych plików jest nie tylko dozwolone — często jest właściwą odpowiedzią na rosnącą złożoność. Dotyczy to zarówno nowych funkcjonalności, jak i dzielenia przerośniętych bytów.

---

## 6. Praca w pętli todo

Duże zmiany planujemy jako listy todo — nawet redundantne.  
Redundancja w planowaniu jest tania. Pominięcie kroku w implementacji — kosztowne.

Pętla: **zaplanuj → zrób jedno todo → zweryfikuj → zaktualizuj listę → dalej**.  
Gdy pojawi się nowy problem w trakcie → dodaj nowe todo zamiast odchodzić od aktualnego.

---

## 7. Kamienie milowe jako punkty weryfikacji

Przy dużych zmianach wyznaczaj kamienie milowe — momenty, w których system jako całość musi działać poprawnie, włącznie z zachowaniem kompatybilności wstecznej.

Kamień milowy to nie tylko "kod działa" — to "testy przechodzą, dokumentacja jest aktualna, baseline nie pogorszony".

---

## 8. Cykliczna aktualizacja dokumentacji

Dokumentacja nie jest opcjonalna ani odrębnym krokiem "na końcu".  
Co jakiś czas — i obowiązkowo po każdym kamieniu milowym — zaktualizuj wszystkie powiązane pliki `*.md`. Nieaktualna dokumentacja jest gorsza niż jej brak, bo aktywnie wprowadza w błąd.

---

## 9. Nie zwiększaj liczby błędów

Istniejące błędy testów, których nie naprawiamy, są śledzone jako baseline.  
Każda zmiana musi ten baseline zachować. Nowe błędy === regresja === cofnij lub napraw.

Naprawianie starych błędów jest dopuszczalne tylko wtedy, gdy zostało jawnie zlecone.

---

## 10. Testy jako pierwsza klasa

Testy nie są dodatkiem — są weryfikacją że implementacja jest kompletna.  
Każda nowa funkcjonalność wymaga testów obejmujących: poprawny przypadek, błędny przypadek i — jeśli dotyczy — wykonanie na poziomie runtime. skupiaj sie bardziej na testach smoke'owych, szczególnie w fazie prototypowania. dokładne testy rób tylko dla logiki która jest pewna że się nie zmieni albo testuje jeden konkretny model bez zależności.

---

## 11. Nowe funkcjonalności IDE

Nowa funkcjonalność UI jest realizowana jako mały, wyspecjalizowany Web Component (Light DOM). Wzorzec, zasady i pipeline dodawania: → [ide.md](ide.md) §13.
