# TransLink Vancouver

Les **prochains passages** TransLink (autobus, SkyTrain, SeaBus), l'**état des
lignes du SkyTrain** et les **vélos Mobi** près de chez vous, dans Gladys.

Cette intégration n'est affiliée ni à TransLink ni à Mobi by Rogers.

## Démarrer en 3 étapes

Aucune connaissance technique n'est nécessaire, et aucun compte non plus pour
commencer.

1. **Vérifiez l'adresse de votre maison dans Gladys** : _Paramètres →
   Maisons_. La maison doit avoir une position sur la carte. L'intégration s'en
   sert pour trouver les arrêts proches de chez vous. La position reste dans
   votre Gladys.
2. **Installez l'intégration** depuis le catalogue des intégrations, et
   acceptez l'accès à la position de la maison. Ouvrez sa page de
   configuration et cliquez sur **Enregistrer**, sans rien remplir.
3. Ouvrez l'onglet **Découverte** de l'intégration. Les 3 arrêts et les 2
   stations Mobi les plus proches de chez vous y sont proposés, avec leur nom
   et la direction des lignes, par exemple « TransLink – Waterfront Station @
   Bay 2 (50 → False Creek South) ». Cliquez sur **Ajouter** pour chacun de
   ceux qui vous intéressent.

C'est tout. Vous avez maintenant, pour chaque arrêt, les **prochains
passages**, et pour chaque station Mobi, les vélos et les places libres.

Le message en haut de la page de configuration indique toujours la prochaine
chose à faire. Par exemple : « Prêt : 3 arrêts et 2 stations Mobi à ajouter.
Ouvrez l'onglet Découverte… ».

Les noms des appareils commencent par **TransLink –** ou **Mobi –**, pour les
reconnaître d'un coup d'œil dans la liste des appareils de Gladys. Vous pouvez
les renommer librement dans Gladys.

Une station du SkyTrain est proposée une seule fois, pour tous ses quais. Ses
quais d'autobus (« Bay 1 », « Bay 2 »…) sont des arrêts à part.

### Afficher les passages sur le tableau de bord

1. Ouvrez le tableau de bord, puis cliquez sur **Modifier**.
2. Ajoutez un widget et choisissez **Passages TransLink**.
3. Choisissez l'arrêt, puis enregistrez.

Le widget **Station Mobi** s'ajoute de la même façon. Le widget **État des
lignes TransLink** demande une clé TransLink (voir plus bas).

Sans clé, les horaires prévus sont marqués d'un **~** et en gris : « ~12 min »
signifie « prévu dans 12 minutes ». Les passages suivis en temps réel sont en
vert, sans ~.

## Passer au temps réel officiel et ajouter les lignes (facultatif)

Sans clé, les passages viennent de Transitous, un service communautaire
gratuit : les horaires prévus, et le temps réel quand Transitous l'a.

Avec une **clé d'API TransLink**, gratuite et personnelle :

- les passages viennent directement du flux **temps réel de TransLink**, mis
  à jour chaque minute ;
- l'appareil **TransLink – SkyTrain et SeaBus** apparaît, avec l'état des
  lignes Expo, Millennium et Canada, du SeaBus et du West Coast Express.

### Obtenir la clé d'API TransLink (5 minutes)

1. Allez sur le [portail développeurs de TransLink](https://developer.translink.ca)
   et **créez un compte** (_Register_). Confirmez le courriel que vous
   recevez.
2. Connectez-vous : la page de votre compte affiche votre **clé d'API**
   (_API Key_). Copiez-la.
3. Dans Gladys, ouvrez la configuration de l'intégration. Collez la clé dans
   **Clé d'API TransLink**, puis cliquez sur **Enregistrer**.
4. Cliquez sur **Tester la clé d'API TransLink**. Les deux lignes doivent
   afficher ✔.
5. Retournez dans l'onglet **Découverte** et ajoutez l'appareil **TransLink –
   SkyTrain et SeaBus**.

Les libellés du portail peuvent varier légèrement.

**Requêtes.** Une seule lecture du flux de TransLink sert tous vos arrêts :
avec les réglages par défaut, l'intégration fait environ 2 200 requêtes par
jour, **quel que soit le nombre d'arrêts**. Le message de la page de
configuration affiche l'estimation pour votre installation.

## Surveiller d'autres arrêts (travail, école…)

Pour un arrêt loin de chez vous :

1. En bas de la page de configuration, cliquez sur **Chercher un arrêt**.
   Tapez un nom de rue, de station ou le numéro de l'arrêt, par exemple
   « Granville Station » ou « Davie Bidwell ».
2. La réponse liste les arrêts avec leur numéro et la direction de leurs
   lignes, par exemple `50040 — Waterfront Station @ Bay 2 (50 → False Creek South)`.
3. Copiez le numéro (`50040`) dans **Arrêts**, enregistrez, puis ajoutez
   l'arrêt dans l'onglet **Découverte**.

Le numéro est aussi celui inscrit sur chaque panneau d'arrêt TransLink
(« Stop #50040 »).

Pour les stations Mobi, le bouton **Chercher une station Mobi** fonctionne de
la même façon.

### Pour aller plus loin

Le champ **Arrêts** accepte plusieurs numéros séparés par des virgules, un
filtre de lignes après `@` et un nom après `:`.

| Saisie                    | Signification                                    |
| ------------------------- | ------------------------------------------------ |
| `50040`                   | toutes les lignes qui passent à l'arrêt 50040    |
| `61935@99`                | seulement la ligne 99                            |
| `61935@99\|14`            | les lignes 99 et 14                              |
| `61935@99:Bus du travail` | ligne 99, affiché sous le nom « Bus du travail » |

## Ce que contient chaque appareil

**Arrêt :**

- **Prochain passage**, **Passage 2**… : les minutes d'attente. 999 signifie
  qu'aucun passage n'est prévu.
- **Ligne du prochain passage**… : le numéro de ligne (« 99 », « Canada
  Line »).
- **Prochains passages** : un résumé, par exemple `99 3 min · 14 ~11 min`.

**SkyTrain et SeaBus** (avec une clé) : pour chaque ligne, un **état**
(`Normal`, `Perturbé`, `Avis` ou `Inconnu`) et le **message** de l'alerte de
TransLink. Une alerte sur une seule station (ascenseur, entrée, quai
d'autobus) ne change pas l'état de la ligne.

**Station Mobi :** les vélos (électriques compris), les vélos électriques, les
points d'ancrage libres et l'état de la station.

Une station qui disparaît du réseau Mobi affiche 0 vélo, 0 place et l'état
« Retirée du réseau Mobi (saisonnier ?) », avec un point orange sur
l'appareil. Elle reprend toute seule quand elle revient.

## Scènes

**Déclencheurs :**

- **Passage imminent** : un passage a lieu dans moins de 1, 2, 3, 5, 10 ou 15
  minutes. Exemple : « quand le 99 est à 5 minutes, allumer la lampe de
  l'entrée ».
- **État d'une ligne modifié** : une ligne est perturbée, revient à la
  normale, ou reçoit un avis. Exemple : « si la ligne Expo est perturbée,
  m'envoyer un message ».
- **Station Mobi modifiée** : la station n'a plus de vélos ou de places, ou en
  retrouve.

**Actions :**

- **Lire les prochains passages** : par exemple, un message chaque matin « Ton
  99 passe dans {{minutes}} minutes ».
- **Lire l'état d'une ligne** : renvoie l'état, le message de TransLink et
  `normal` (vrai ou faux).

## Dépannage

| Message ou symptôme                                    | Que faire                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| « indiquez l'adresse de votre maison »                 | _Paramètres → Maisons_ : placez la maison sur la carte, puis enregistrez à nouveau la configuration de l'intégration.           |
| « Gladys n'a pas partagé la position de votre maison » | Réinstallez l'intégration et acceptez l'accès à la position, ou tapez des numéros d'arrêt.                                      |
| Rien dans l'onglet Découverte                          | Lisez le message de la page de configuration : il dit ce qui manque.                                                            |
| « TransLink a refusé la clé d'API »                    | Vérifiez la clé sur le portail développeurs, puis collez-la à nouveau.                                                          |
| « L'arrêt … n'est pas dans la liste des arrêts »       | Vérifiez le numéro sur le panneau. Un arrêt tout nouveau arrive avec la prochaine version de l'intégration.                     |
| Station « Retirée du réseau Mobi »                     | La station n'est plus dans le réseau Mobi : elle reviendra seule. Pour en suivre une autre, voir « Chercher une station Mobi ». |
| Un arrêt reste à 999                                   | Aucun passage prévu (la nuit), ou un filtre de ligne qui ne correspond à aucune ligne de l'arrêt.                               |

## Vie privée, données et licences

- La position de la maison ne sert qu'à chercher les arrêts proches, dans la
  liste des arrêts livrée avec l'intégration : elle n'est envoyée nulle part.
- Liste des arrêts : GTFS de TransLink, livré avec l'intégration (mis à jour à
  chaque version).
- Passages sans clé : [Transitous](https://transitous.org/sources/), un
  service communautaire gratuit, à partir des données de TransLink.
- Temps réel et alertes : données ouvertes de TransLink, selon les
  [conditions d'utilisation](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources)
  de TransLink.
- Vélos : flux GBFS public de Mobi by Rogers.
- Code de l'intégration : licence Apache 2.0.
