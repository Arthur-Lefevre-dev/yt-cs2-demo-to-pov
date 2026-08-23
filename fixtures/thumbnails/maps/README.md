# Miniatures YouTube — fonds de map

Place tes screenshots de maps ici pour le générateur de miniatures.

## Structure

```
fixtures/thumbnails/maps/
  de_mirage/          ← images pour Mirage
    shot-01.jpg
    shot-02.png
  de_nuke/
  de_train/
  de_inferno/
  de_dust2/
  de_ancient/
  de_anubis/
  de_vertigo/
  de_overpass/
  de_cache/
  _default/           ← fallback si la map du match n’a pas de dossier
    any.jpg
```

## Règles

- Formats : `.jpg` / `.jpeg` / `.png` / `.webp`
- Idéalement **16:9** (le générateur crop en 1920×1080)
- Plusieurs images par map → une est choisie **au hasard** (et peut varier entre les 3 variantes A/B)
- Nom du dossier = nom de map CSDM (`de_nuke`, `de_mirage`, …)

Le générateur compose : fond map (flou / saturé) + logo équipe optionnel (filigrane) + photo joueur (gauche) + texte (nom, score, rating, map).

Logos d'équipe : voir [`../teams/README.md`](../teams/README.md).
