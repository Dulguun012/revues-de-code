# TD1 — Première revue : la caisse du magasin

Objectif : faire votre **première revue de code complète** sur github.com —
annotations en ligne puis corrections proposées, le tout dans une pull
request.

## Le code à revoir

- `src/cart.ts` : un petit module de caisse (panier, total TTC, encaissement).
- Il contient **volontairement plusieurs problèmes**. À vous de les trouver,
  de les commenter, puis d'en corriger au moins trois.

## À faire

1. **Forkez** ce dépôt (bouton *Fork*, en haut à droite de la page GitHub).
2. Clonez votre fork et créez votre branche **depuis `td1`** :

   ```sh
   git clone https://github.com/<votre-pseudo>/revues-de-code.git
   cd revues-de-code
   git fetch origin
   git checkout -b td1-<votre-pseudo> origin/td1
   ```

3. Ouvrez la **pull request** :
   github.com → votre dépôt → onglet *Pull requests* → *New pull request*.
   - base : la branche principale du dépôt du cours (`IUT-BUT3-2026/revues-de-code`)
   - compare : `td1-<votre-pseudo>` (depuis votre fork)
   - complétez le corps avec le **modèle fourni** automatiquement.
4. **Annotez** le code : sur l'onglet *Files changed* de la PR, cliquez sur
   une ligne pour la commenter. Un commentaire = un problème, avec le
   *pourquoi*. Visez au moins **5 problèmes identifiés**.
5. **Corrigez** ensuite au moins **3 problèmes** : modifiez le code, puis
   `git add` / `git commit` / `git push` — la PR se met à jour toute seule.
6. Laissez la PR **ouverte** et déposez son lien à l'endroit indiqué par
   l'enseignant (Moodle, mail…).

## Consignes de revue

- Appliquez la [checklist de revue](../../templates/checklist-revue.md).
- Les **attitudes du Module 1** : sur le code, pas sur la personne ;
  expliquer le *pourquoi* ; suggérer, ne pas imposer.
- Titre de la PR : `TD1 – <pseudo> – revue de cart.ts`.

## Pistes (à n'ouvrir qu'après votre revue)

<details>
<summary>Ce qu'il fallait trouver</summary>

- Cas limites non gérés : prix négatif, quantité à 0, `NaN`/`Infinity` ;
- calcul de la TVA et arrondis (flottants) ;
- mélange des responsabilités : calcul vs affichage ;
- typage imprécis (retour implicite, `number` au lieu de types métier) ;
- valeurs magiques et noms peu explicites ;
- absence de tests.
</details>

## Évaluation (sur 20)

| Critère | Points |
|---------|--------|
| Commentaires pertinents (au moins 5 problèmes réels) | 6 |
| Corrections proposées (au moins 3, réelles) | 6 |
| Justification (le *pourquoi* est expliqué) | 4 |
| Corps de PR et ton constructif | 4 |
