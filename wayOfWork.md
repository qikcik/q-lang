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

## 11. Framework tworzenia funkcjonalności IDE (Web Components)

Nowa funkcjonalność UI jest realizowana jako **mały, wyspecjalizowany Web Component** (Light DOM). Wzorzec jest powtarzalny i dokumentowany poniżej jako receptura.

### Wzorzec komponentu

```
class QLangXxx extends HTMLElement {
  connectedCallback() {
    if (this._built) return;   // guard — tylko raz
    this._built = true;
    this._pre = this.querySelector('pre') ?? ...; // adopt existing children
    // setup: listeners, initial state
  }

  // Semantic API (metody, nie bezpośrednia manipulacja DOM)
  setData(data) { ... }
  clear() { ... }

  // Semantic events (bubbling CustomEvent z detail)
  // this.dispatchEvent(new CustomEvent('ql-xxx', { bubbles: true, detail: {...} }));
}
customElements.define('qlang-xxx', QLangXxx);
```

### Zasady

1. **Light DOM** — zero Shadow DOM. Komponent adoptuje istniejące dzieci z HTML (np. `<pre>`), nie tworzy nowych struktur DOM.
2. **Mały rozmiar** — optymalnie 30–70 linii. Jeden plik = jedna odpowiedzialność. Jeśli rośnie ponad 100 — rozbij.
3. **Semantic API** — komponent eksponuje metody (`setErrors()`, `log()`, `clear()`), nie wymaga wiedzy o wewnętrznej strukturze DOM.
4. **Semantic events** — komponent dispatches zdarzenia z prefiksem `ql-` (`ql-error-click`, `ql-compile`), a nie surowe kliknięcia.
5. **Graceful degradation** — `main.js` wiąże się z komponentem przez `?.` : `if (component?.method) component.method(); else legacyFallback();`. UI działa nawet gdy komponent nie jest zarejestrowany.
6. **Adopcja dzieci** — komponent nie kasuje istniejących elementów HTML; adoptuje je (`this.querySelector(...)`) i nadaje im zachowanie.

### Pipeline dodawania nowej funkcjonalności UI

```
1. Specyfikacja    — co komponent robi, jakie API, jakie eventy
2. Plik komponentu — ide/qlang-xxx.js  (30–70 linii)
3. HTML            — <qlang-xxx> owijający istniejące elementy w index.html
4. Wire            — main.js importuje komponent, nasłuchuje eventów, z fallbackiem
5. Testy smoke     — test-ide-smoke.js: plik istnieje, ID w HTML, tag w HTML
6. Dokumentacja    — ide.md: opis komponentu, API, eventy
```

### Istniejące komponenty

| Komponent | Plik | Rozmiar | API | Eventy |
|---|---|---|---|---|
| `<qlang-source-view>` | `source-view.js` | ~450 | `setText`, `setContent`, `hoverData=`, `setBpLines`, `highlightNode` | `sv-gutter-click`, `sv-node-click` |
| `<qlang-pane>` | `qlang-pane.js` | ~40 | (strukturalny wrapper) | — |
| `<qlang-toolbar>` | `qlang-toolbar.js` | ~33 | (interceptuje kliknięcia) | `ql-compile`, `ql-run`, `ql-debug`, `ql-clear` |
| `<qlang-error-panel>` | `qlang-error-panel.js` | ~73 | `setErrors()`, `log()`, `clear()` | `ql-error-click` |
| `<qlang-console>` | `qlang-console.js` | ~34 | `log()`, `clear()` | — |
