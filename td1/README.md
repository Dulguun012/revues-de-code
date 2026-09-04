# TD1 — Première revue : la caisse du magasin

Objectif : faire votre **première revue de code complète**, en groupe, sur
github.com — annotations en ligne puis corrections proposées, le tout dans
une pull request.

## Le code à revoir

- `src/cart.ts` : un petit module de caisse (panier, total TTC, encaissement).
- Il contient **volontairement plusieurs problèmes**. À vous de les trouver,
  de les commenter, puis d'en corriger au moins trois.

## Constitution du groupe

- Se regrouper (taille indiquée par l'enseignant, ex. 2-3 étudiants).
- Désigner un **porteur** : c'est lui qui forke le dépôt et son **nom de
  famille** donne le préfixe du groupe (ex. `2026-IUT-BUT3-DUPONT`).
- Lire les consignes générales dans [`td/README.md`](../td/README.md) :
  nommage, `GROUPE.md`, déroulé complet.

## Étapes précises

1. **Le porteur forke** le dépôt `IUT-BUT3-2026/revues-de-code` (bouton
   *Fork*).
2. **Le porteur ajoute les membres** : fork → *Settings* → *Collaborators* →
   pseudo GitHub de chaque membre (ils acceptent l'invitation par email).
3. **Cloner et créer la branche préfixée** (par le porteur ou un membre) :

   ```sh
   git clone https://github.com/<porteur>/revues-de-code.git
   cd revues-de-code
   git fetch origin
   git checkout -b 2026-IUT-BUT3-DUPONT-td1 origin/td1
   ```

   (remplacer `2026-IUT-BUT3-DUPONT` par le préfixe de votre groupe)

4. **Remplir `GROUPE.md`** (à la racine) : préfixe, porteur, membres, TD.
   Commit :

   ```sh
   git add GROUPE.md
   git commit -m "GROUPE : identification du groupe"
   ```

5. **Ouvrir la pull request** : github.com → fork du groupe → *Pull
   requests* → *New pull request* :
   - base : branche principale du dépôt du cours (`IUT-BUT3-2026/revues-de-code`)
   - compare : `2026-IUT-BUT3-DUPONT-td1` (depuis le fork du groupe)
   - titre : `2026-IUT-BUT3-DUPONT — TD1 — revue de cart.ts`
   - corps : compléter le **modèle fourni** automatiquement
6. **Annoter le code** : onglet *Files changed* de la PR → cliquer sur une
   ligne pour commenter. **Un commentaire = un problème**, avec le *pourquoi*.
   Minimum : **5 problèmes identifiés**.
7. **Corriger** au moins **3 problèmes** :

   ```sh
   git add .
   git commit -m "TD1 : corrections proposées"
   git push origin 2026-IUT-BUT3-DUPONT-td1
   ```

   La PR se met à jour à chaque push.
8. **Rendre** : coller le **lien de la PR** dans la section « Rendu » de
   `GROUPE.md`, commit + push. Laisser la PR **ouverte** et déposer le lien à
   l'endroit indiqué par l'enseignant.

## Consignes de revue

- Appliquer la [checklist de revue](../../templates/checklist-revue.md).
- **Attitudes du Module 1** : sur le code, pas sur la personne ; expliquer le
  *pourquoi* ; suggérer, ne pas imposer.

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
| Corps de PR, ton et `GROUPE.md` complet | 4 |
