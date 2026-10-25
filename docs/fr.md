# MinIO

[MinIO](https://min.io/) est un serveur de stockage objet auto-hébergé,
compatible avec Amazon S3. Cette intégration amène un serveur ou un cluster
MinIO dans Gladys : son espace libre, ses disques et ses nœuds en ligne ou hors
ligne, ses objets, et un appareil par bucket avec sa taille. Des scènes peuvent
réagir quand MinIO ne répond plus, quand un disque ou un nœud passe hors ligne,
ou quand l'espace libre baisse ; un widget de tableau de bord montre la
capacité et les plus gros buckets. L'intégration ne fait que lire : elle
n'écrit jamais dans MinIO.

Testée sur un vrai MinIO RELEASE.2026-10-23 (compilé depuis les sources de
MinIO par Chainguard, un cluster de 4 nœuds et un serveur à 4 disques, en
Docker) : un nœud arrêté, un disque rendu illisible, deux disques perdus
(quorum d'écriture perdu), le serveur arrêté puis relancé. Lit aussi un MinIO
de mai 2025. MinIO ne publie plus d'images Docker de son édition
communautaire depuis fin 2025 : l'intégration lit les métriques que toutes les
versions de MinIO proposent depuis des années, la façon de l'installer ne
compte pas. Pas encore testée sur un vrai Gladys : vos retours sont les
bienvenus dans [les issues](https://github.com/guim31/gladys-minio/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un serveur ou un cluster MinIO joignable depuis la machine de Gladys, sur le
  port de son **API S3** (9000 par défaut), pas sur celui de sa console (9001).
- Un utilisateur MinIO autorisé à lire les métriques (le droit
  `admin:Prometheus`), ou des métriques ouvertes à tous avec
  `MINIO_PROMETHEUS_AUTH_TYPE=public`.

L'intégration lit deux pages de métriques toutes les minutes par défaut : des
requêtes légères, sur votre propre réseau.

## Mise en route

### 1. Créer un utilisateur qui ne lit que les métriques

Avec le client `mc`, créez une politique qui n'autorise que les métriques, un
utilisateur, et attachez-lui la politique :

```
cat > gladys-metrics.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": ["admin:Prometheus"], "Resource": ["arn:aws:s3:::*"] }]
}
EOF
mc admin policy create myminio gladys-metrics gladys-metrics.json
mc admin user add myminio gladys <une-longue-clé-secrète>
mc admin policy attach myminio gladys-metrics --user gladys
```

Cet utilisateur ne peut ni lire ni écrire le moindre objet. Inutile de générer
un jeton avec `mc admin prometheus generate` : l'intégration signe le sien,
avec la clé secrète, à chaque requête.

### 2. Configurer l'intégration

Dans Gladys, ouvrez l'intégration MinIO et saisissez :

- **Adresse de MinIO** : par ex. `http://192.168.1.2:9000`, ou
  `https://s3.example.org` derrière un proxy inverse. Une adresse seule utilise
  le port 9000.
- **Clé d'accès** et **Clé secrète** de l'utilisateur créé plus haut. Laissez
  les deux vides si les métriques sont publiques.
- **Accepter un certificat auto-signé** seulement pour une adresse en
  `https://` dont le certificat n'est pas signé par une autorité connue.
- **Intervalle de rafraîchissement** (1 minute par défaut), **Seuil d'espace
  libre bas (%)** (10 % par défaut) et la **Langue des noms**.

**Tester la connexion** lit MinIO tout de suite et répond en une ligne :
version, espace libre, disques, buckets.

Sur un cluster, n'importe quel nœud convient, mais l'intégration ne voit que ce
que voit le nœud qu'elle lit : si ce nœud s'arrête, MinIO « ne répond plus ».
Visez plutôt un répartiteur de charge devant les nœuds quand il y en a un.

### 3. Ajouter les appareils

Dans l'onglet **Découverte**, ajoutez le serveur **MinIO** et les buckets à
suivre. Rien n'est créé sans vous.

## Les appareils

L'appareil **MinIO** :

- **En ligne** : 1 tant que MinIO répond.
- **En bonne santé (quorum)** : 1 tant que chaque jeu d'effacement a assez de
  disques pour accepter les écritures. À 0, MinIO refuse les nouveaux objets.
- **Version** : la date de RELEASE de MinIO (la plus récente quand les nœuds
  diffèrent).
- **Données stockées** : la taille des objets (Go).
- **Espace libre** et **Capacité utilisable** : après la parité du codage à
  effacement (Go), les chiffres que montre `mc admin info`.
- **Espace libre (%)** : l'espace libre rapporté à la capacité utilisable.
- **Objets** et **Buckets**.
- **Disques en ligne**, **Disques hors ligne**, **Nœuds hors ligne**.
- **Disques en réparation** : les disques que MinIO reconstruit après un
  remplacement.

Un appareil par bucket : **Taille** (Mo) et **Objets**. Un bucket supprimé dans
MinIO apparaît injoignable dans Gladys.

MinIO calcule les disques, les nœuds et la capacité en arrière-plan : un disque
perdu apparaît en une à deux minutes. Les objets et les tailles viennent de son
scanner, qui tourne aussi en arrière-plan : sur un serveur neuf, ils
apparaissent après son premier passage, et ils suivent les envois avec du
retard.

## Tableau de bord

Le widget **MinIO** montre une jauge de la capacité utilisée (verte, orange à
l'approche du seuil, rouge en dessous), l'espace libre, les disques hors ligne
et les objets, puis les buckets, les plus gros d'abord, avec leur taille et
leurs objets (dix lignes au plus). Ses réglages choisissent les buckets à
montrer (vide : tous). Le bouton **Actualiser** relit MinIO. Quand MinIO ne
répond pas, ou a perdu son quorum d'écriture, le widget le dit.

## Scènes

### Déclencheurs

- **MinIO ne répond plus** : deux lectures de suite ont échoué. Variables :
  adresse du serveur, raison.
- **MinIO répond de nouveau** : avec la durée de l'interruption en minutes.
- **Disque MinIO hors ligne** : plus de disques sont hors ligne qu'à la lecture
  précédente. Quand un nœud entier s'arrête, ses disques partent avec lui : ce
  déclencheur et le suivant partent tous les deux.
- **Disque MinIO revenu** : moins de disques sont hors ligne.
- **Nœud MinIO hors ligne** et **Nœud MinIO revenu** : la même chose pour les
  nœuds d'un cluster.
- **Espace libre MinIO bas** : l'espace libre est passé sous le seuil de la
  configuration. Il ne se déclenche de nouveau qu'une fois l'espace libre
  remonté d'un point au-dessus du seuil.

Les déclencheurs de disque, de nœud et de seuil portent les comptes (disques
hors ligne et en ligne, nœuds hors ligne et en ligne, espace libre). Ce qui a
été vu est gardé par l'intégration : un disque perdu pendant un redémarrage de
Gladys est quand même annoncé, une fois.

### Actions

- **État de MinIO** : lit MinIO pour les actions suivantes : en ligne, en bonne
  santé, version, espace libre, objets, buckets, disques, et une phrase toute
  prête (« MinIO : 400 GB libres (40 %), 0 disque(s) hors ligne. »). Quand
  MinIO ne répond pas, elle le dit au lieu d'échouer.
- **État d'un bucket** : la taille et les objets d'un bucket, et une phrase.

### Idées de scènes

- **Un disque tombe** : sur « Disque MinIO hors ligne », envoyer un message
  avec le nombre de disques hors ligne, une variable du déclencheur.
- **Stockage presque plein** : sur « Espace libre MinIO bas », envoyer un
  message avec l'espace libre et le seuil.
- **Chaque dimanche** : à 10 h, « État de MinIO », puis envoyer sa phrase.

## Dépannage

- **« Accès refusé »** : clé d'accès ou clé secrète fausse, ou l'utilisateur
  n'a pas le droit `admin:Prometheus`. MinIO répond la même chose dans les deux
  cas.
- **« Aucun serveur MinIO à cette adresse »** : l'adresse est sans doute celle
  de la console (9001) : utilisez le port de l'API (9000 par défaut).
- **« Certificat refusé »** : cochez « Accepter un certificat auto-signé », ou
  utilisez l'adresse en `http://`.
- **Ni objets ni buckets** : le scanner de MinIO n'a pas fini son premier
  passage : patientez quelques minutes.
- Journaux détaillés : `LOG_LEVEL=debug` sur le conteneur de l'intégration.

## Limites

- Lecture seule : aucun bucket n'est créé, vidé ou supprimé depuis Gladys.
- Les comptes de disques et de nœuds sont ceux de tout le cluster : les
  métriques de MinIO ne disent pas quel disque est tombé (`mc admin info`, si).
- Les tailles viennent du scanner de MinIO et suivent avec du retard.
- L'intégration n'a pas été testée avec les remplaçants compatibles S3 (Garage,
  SeaweedFS) : leurs métriques diffèrent, ils ne sont pas pris en charge.
- Un serveur ou cluster MinIO par installation de l'intégration.
- Sans lien avec MinIO, Inc.
