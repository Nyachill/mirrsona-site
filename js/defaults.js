// このファイルは tools/build-manifest.js が自動生成する。手で編集しない。
// サーバーにも端末にもデータが無いとき（初回オフライン起動など）に使う内蔵データ。
window.MR = window.MR || {};
MR.DEFAULT_DATA = {
  "version": "0.1.0-6951c6-embedded",
  "files": {
    "config/game.json": {
      "level": "arena01",
      "city": {
        "enemies": true,
        "vehicles": true,
        "ambience": "ambience_city",
        "enemyCount": 7,
        "spawnMin": 40,
        "spawnMax": 120,
        "despawnDist": 220,
        "spawnViewAngle": 75,
        "spawnInterval": 0.8,
        "roles": {
          "street": 0.35,
          "lobby": 0.3,
          "roof": 0.35
        },
        "climberChance": 0.6,
        "maxOnRoofs": 3,
        "pathBudgetMs": 2.5,
        "graphBudgetMs": 2.5,
        "pathMaxExpand": 6000,
        "maxVehicles": 24,
        "airSpawnAgl": 40,
        "airSpawnSpeed": 15,
        "jets": true,
        "enemy": {
          "detectRange": 110,
          "attackRange": 45,
          "roofAttackRange": 75,
          "hitChance": 0.38,
          "speed": 3.8,
          "ladderSpeed": 2.4,
          "repathCity": 2.5,
          "overwatchPatience": 12,
          "heliAttackRange": 90,
          "jetAttackRange": 70
        },
        "audio": {
          "indoorCeiling": 25,
          "indoorAmbience": 0.4,
          "windFrom": 30,
          "windFull": 140,
          "waterLapRange": 40
        }
      },
      "loot": {
        "start": {
          "weapons": [
            "pistol"
          ],
          "ammo": {
            "9mm": 30
          },
          "meds": {
            "bandage": 1
          }
        },
        "calibres": {
          "57": {
            "name": "5.7mm",
            "cap": 250,
            "box": 50,
            "color": "#1fb7cc"
          },
          "338": {
            "name": ".338",
            "cap": 30,
            "box": 8,
            "color": "#a56cf0"
          },
          "556": {
            "name": "5.56",
            "cap": 240,
            "box": 40,
            "color": "#5cc23a"
          },
          "9mm": {
            "name": "9mm",
            "cap": 150,
            "box": 30,
            "color": "#e9c22a"
          },
          "12g": {
            "name": "12ga",
            "cap": 40,
            "box": 10,
            "color": "#ff5a46"
          }
        },
        "weaponCalibre": {
          "p90": "57",
          "rifle": "556",
          "lmg": "556",
          "shotgun": "12g",
          "sniper": "338",
          "pistol": "9mm"
        },
        "shortNames": {
          "p90": "P90",
          "rifle": "AR",
          "shotgun": "SG",
          "lmg": "LMG",
          "sniper": "SR",
          "pistol": "HG"
        },
        "sidearms": [
          "pistol"
        ],
        "weaponLoaded": 1,
        "meds": {
          "medkit": {
            "heal": 75,
            "time": 4,
            "cap": 3
          },
          "bandage": {
            "heal": 20,
            "time": 2,
            "cap": 8
          }
        },
        "heal": {
          "moveScale": 0.5,
          "bandageBelow": 30
        },
        "armor": {
          "vest": {
            "reduce": 0.3,
            "durability": 100
          },
          "helmet": {
            "reduce": 0.4,
            "durability": 80
          },
          "headChance": 0.15,
          "enemyHeadMult": 1.5
        },
        "pickupRadius": 1.6,
        "pickupHeight": 1.2,
        "autoRadius": 1.1,
        "drawDist": 40,
        "drawDistMobile": 32,
        "ringDist": 40,
        "itemScale": 1.35,
        "weaponScale": 1.3,
        "ringWeapon": 1,
        "ringItem": 0.62,
        "ringGlow": 1.7,
        "ringSpin": 0.06,
        "ringColors": {
          "weapon": "#ffcf4a",
          "med": "#5ee08a",
          "armor": "#5aaeff"
        },
        "respawnSec": 150,
        "dropLifetime": 300,
        "enemyDrop": {
          "ammoBoxes": 1,
          "bandageChance": 0.4,
          "medkitChance": 0.08
        },
        "deathDrop": true
      },
      "royale": {
        "jets": true,
        "contestants": 30,
        "realRange": 120,
        "maxReal": 5,
        "timeScale": 1,
        "virtual": {
          "speed": 4.2,
          "hp": 100,
          "spread": 1100,
          "pace": 1.25,
          "fightRange": 450
        },
        "transport": {
          "enabled": true,
          "height": 420,
          "speed": 85,
          "margin": 250,
          "offset": 700
        },
        "fall": {
          "speed": 55,
          "minSpeed": 40,
          "horiz": 24,
          "accel": 2.5,
          "chuteHeight": 90,
          "chuteSpeed": 8,
          "chuteFwdMax": 12,
          "chuteBack": 4,
          "chuteDown": 4.2,
          "chuteDownMin": 2.8,
          "chuteDownMax": 6.5,
          "chuteStrafe": 3,
          "openTime": 0.62
        },
        "zone": {
          "wallHeight": 700,
          "wallOpacity": 0.45,
          "tick": 1
        },
        "resultDelay": 1.6
      },
      "minimap": {
        "radius": 250,
        "flyRadius": 650,
        "flyFrom": 25,
        "flyTo": 180,
        "rotate": true,
        "tileRes": 2,
        "tileSize": 256,
        "overviewRes": 8,
        "overviewFrom": 420,
        "maxTiles": 24,
        "hz": 30,
        "labels": true,
        "vehicleRange": 400
      },
      "respawn": {
        "enabled": true,
        "autoAfter": 0,
        "nearMin": 40,
        "nearMax": 140,
        "nearPref": 70,
        "nearAngles": 12,
        "nearRingSteps": 3,
        "nearGrow": 100,
        "nearMaxFar": 450,
        "enemyClear": 35,
        "losRange": 120,
        "maxCleared": 2,
        "maxMoved": 0,
        "maxZoneFallbacks": 2,
        "nearRoofPenalty": 5,
        "streetMaxH": 0.6,
        "roofMinH": 2.5,
        "maxPush": 0.3,
        "headroom": 1.9,
        "stepHint": 0.3,
        "probeR": 0.3,
        "vehicleClear": 1.5,
        "specClear": 3,
        "jetClear": 1.5,
        "heliClear": 6.5,
        "padRim": 1.5,
        "padHeliDy": 3,
        "vehicleDy": 4,
        "vehicleScan": 20,
        "hideGap": 1.5,
        "bridgeStep": 1.5,
        "deckZones": [
          "carrier"
        ],
        "deckEdge": 3,
        "laneClear": 4,
        "deckLandingClear": 1,
        "deckPathEdge": 1,
        "deckPathStep": 1,
        "deckNoseAhead": 30,
        "deckSweepPenalty": 25,
        "pickPpm": 0.5,
        "pickSnap": 12,
        "pickSnapPx": 24,
        "pickSnapMax": 40,
        "pickStep": 2,
        "pickRings": 12,
        "pickMaxPts": 500,
        "waterSnapPx": 10,
        "waterSnapMax": 10,
        "pickBadTime": 1.5,
        "pickTapMs": 1000,
        "chipHoldMs": 800,
        "resumeTries": 6,
        "fineSnap": 6,
        "fineStep": 1,
        "searchMsPerFrame": 1,
        "rescanSec": 1,
        "navOpsPerFrame": 1,
        "loadOpsPerFrame": 2,
        "leadDelay": 0.5,
        "loadMaxSec": 4,
        "loadingNoteAfter": 0.25,
        "fadeSec": 0.35,
        "fadeMaxSec": 1.2,
        "faceClear": 6,
        "faceStep": 15,
        "faceFan": 45,
        "faceFar": 20,
        "faceTurnCost": 1,
        "arena": {
          "nearMin": 15,
          "nearMax": 40,
          "enemyClear": 12,
          "losRange": 60,
          "maxCleared": 2,
          "maxMoved": 6,
          "randomSamples": 24,
          "pointRings": [
            4,
            8
          ],
          "pointAngles": 8,
          "pointSnap": 1.5
        }
      },
      "player": {
        "maxHealth": 100,
        "moveSpeed": 5.5,
        "jumpSpeed": 6.5,
        "gravity": -20,
        "eyeHeight": 1.6,
        "radius": 0.4,
        "degreesPerInch": 110,
        "mouseSensitivity": 0.15,
        "respawnDelay": 3,
        "height": 1.8,
        "stepUp": 0.45,
        "coyoteTime": 0.1,
        "airControl": 2.5,
        "maxFallSpeed": 50,
        "ladderSpeed": 2.5,
        "swimSpeed": 2.2,
        "swimEyeAbove": 0.25,
        "climbOutHeight": 2.6,
        "climbOutTime": 0.6,
        "vaultHeight": 1.35,
        "vaultTime": 0.45,
        "fallDamage": {
          "minHeight": 6,
          "perMeter": 5,
          "curve": 0.4
        }
      },
      "controls": {
        "fireDragLook": true,
        "leftFireButton": true,
        "jet": "auto"
      },
      "weapons": [
        {
          "id": "p90",
          "name": "P90",
          "damage": 20,
          "fireRate": 15,
          "automatic": true,
          "pellets": 1,
          "magazineSize": 50,
          "reserveAmmo": 200,
          "reloadTime": 2,
          "spread": 0.7,
          "range": 160,
          "recoil": 0.035,
          "model": {
            "file": "models/p90.glb",
            "fallback": "rifle",
            "scale": 1,
            "viewPos": [
              0.14,
              -0.14,
              -0.28
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.085,
              -0.22
            ],
            "viewScale": 0.68,
            "adsAlign": true,
            "foregrip": [
              0,
              0.02,
              -0.17
            ]
          },
          "ads": {
            "fov": 48,
            "time": 0.16,
            "sensitivity": 0.6,
            "spreadScale": 0.5
          },
          "sounds": {
            "fire": "p90_fire",
            "tail": "p90_tail",
            "reload": "reload_p90"
          },
          "flashLight": 6
        },
        {
          "id": "rifle",
          "name": "アサルトライフル",
          "damage": 26,
          "fireRate": 10,
          "automatic": true,
          "pellets": 1,
          "magazineSize": 30,
          "reserveAmmo": 180,
          "reloadTime": 2.3,
          "spread": 0.9,
          "range": 200,
          "recoil": 0.05,
          "flashLight": 7,
          "model": {
            "file": "models/rifle.glb",
            "fallback": "rifle",
            "scale": 1,
            "viewScale": 0.5,
            "viewPos": [
              0.14,
              -0.14,
              -0.28
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.08,
              -0.14
            ],
            "adsAlign": true,
            "foregrip": [
              0,
              0.062,
              -0.317
            ]
          },
          "ads": {
            "fov": 50,
            "time": 0.18,
            "sensitivity": 0.6,
            "spreadScale": 0.45
          },
          "sounds": {
            "fire": "rifle_fire",
            "tail": "rifle_tail",
            "reload": "reload_rifle"
          }
        },
        {
          "id": "shotgun",
          "name": "ショットガン",
          "damage": 11,
          "fireRate": 1.3,
          "automatic": false,
          "pellets": 8,
          "magazineSize": 6,
          "reserveAmmo": 36,
          "reloadTime": 2.2,
          "spread": 5.5,
          "range": 40,
          "recoil": 0.12,
          "model": {
            "file": "models/shotgun.glb",
            "fallback": "shotgun",
            "scale": 1,
            "viewPos": [
              0.15,
              -0.15,
              -0.3
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.09,
              -0.26
            ],
            "viewScale": 0.6,
            "adsAlign": true,
            "foregrip": [
              0,
              0,
              -0.26
            ]
          },
          "ads": {
            "fov": 60,
            "time": 0.2,
            "sensitivity": 0.7,
            "spreadScale": 0.75
          },
          "sounds": {
            "fire": "shotgun_fire",
            "reload": "reload_shotgun"
          },
          "flashLight": 9
        },
        {
          "id": "lmg",
          "name": "ライトマシンガン",
          "damage": 22,
          "fireRate": 12,
          "automatic": true,
          "pellets": 1,
          "magazineSize": 100,
          "reserveAmmo": 200,
          "reloadTime": 5,
          "spread": 1.6,
          "range": 180,
          "recoil": 0.07,
          "flashLight": 7,
          "model": {
            "file": "models/lmg.glb",
            "fallback": "rifle",
            "scale": 1,
            "viewScale": 0.45,
            "viewPos": [
              0.16,
              -0.16,
              -0.3
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.064,
              -0.16
            ],
            "adsAlign": true,
            "foregrip": [
              0,
              0.02,
              -0.394
            ]
          },
          "ads": {
            "fov": 56,
            "time": 0.3,
            "sensitivity": 0.65,
            "spreadScale": 0.35
          },
          "sounds": {
            "fire": "lmg_fire",
            "tail": "rifle_tail",
            "reload": "reload_lmg"
          }
        },
        {
          "id": "sniper",
          "name": "スナイパーライフル",
          "damage": 95,
          "fireRate": 0.9,
          "automatic": false,
          "pellets": 1,
          "magazineSize": 5,
          "reserveAmmo": 30,
          "reloadTime": 3.2,
          "spread": 0.15,
          "range": 400,
          "recoil": 0.25,
          "flashLight": 10,
          "boltAction": true,
          "model": {
            "file": "models/sniper.glb",
            "fallback": "rifle",
            "scale": 1,
            "viewScale": 0.4,
            "viewPos": [
              0.16,
              -0.16,
              -0.3
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.055,
              -0.006
            ],
            "adsAlign": true,
            "foregrip": [
              0,
              0.055,
              -0.36
            ]
          },
          "ads": {
            "fov": 16,
            "time": 0.35,
            "sensitivity": 0.3,
            "spreadScale": 0.1,
            "scope": true
          },
          "sounds": {
            "fire": "sniper_fire",
            "tail": "sniper_tail",
            "reload": "reload_sniper",
            "bolt": "bolt_cycle"
          }
        },
        {
          "id": "pistol",
          "name": "ピストル",
          "damage": 24,
          "fireRate": 6,
          "automatic": false,
          "pellets": 1,
          "magazineSize": 15,
          "reserveAmmo": 90,
          "reloadTime": 1.5,
          "spread": 1.2,
          "range": 60,
          "recoil": 0.06,
          "flashLight": 5,
          "model": {
            "file": "models/pistol.glb",
            "fallback": "rifle",
            "scale": 1,
            "viewScale": 1,
            "viewPos": [
              0.11,
              -0.12,
              -0.22
            ],
            "viewRot": [
              0,
              0,
              0
            ],
            "adsPos": [
              0,
              -0.06,
              -0.16
            ],
            "adsAlign": true,
            "foregrip": [
              0,
              -0.01,
              -0.03
            ]
          },
          "ads": {
            "fov": 62,
            "time": 0.12,
            "sensitivity": 0.75,
            "spreadScale": 0.5
          },
          "sounds": {
            "fire": "pistol_fire",
            "reload": "reload_pistol"
          }
        }
      ],
      "enemies": {
        "maxAlive": 6,
        "spawnInterval": 2.5,
        "minSpawnDistance": 18,
        "health": 100,
        "speed": 3.6,
        "detectRange": 80,
        "attackRange": 16,
        "damage": 8,
        "fireInterval": 1.1,
        "hitChance": 0.45,
        "repathInterval": 0.5,
        "headshotMultiplier": 2,
        "model": {
          "file": "models/soldier.glb",
          "scale": 1,
          "weapon": [
            "models/p90.glb",
            "models/rifle.glb"
          ],
          "gunOffset": {
            "pos": [
              0,
              0,
              0
            ],
            "rot": [
              0,
              0,
              0
            ]
          },
          "hitbox": {
            "head": 0.16,
            "headOffset": 0.06,
            "body": 0.38,
            "chest": 0.32,
            "legs": 0.24
          }
        }
      },
      "stability": {
        "session": {
          "enabled": true,
          "saveEvery": 3,
          "maxAgeMin": 30,
          "webTapToResume": true,
          "visibleWait": 5,
          "airAgl": 4,
          "maxTaken": 300,
          "maxVehState": 12,
          "messageMs": 3000,
          "eventGap": 1
        },
        "crashLoop": {
          "window": 1800,
          "saverAfter": 2,
          "titleAfter": 3,
          "saverStickyHours": 24
        },
        "saver": {
          "city": {
            "landmarks": false,
            "props": false,
            "textureMax": {
              "albedo": 512,
              "normal": 256,
              "orm": 256,
              "emissive": 256,
              "interior": 256,
              "glb": 512,
              "glbDetail": 256
            }
          },
          "render": {
            "props": false
          },
          "audio": {
            "music": false
          }
        },
        "contextLoss": {
          "pause": true,
          "rehydrateMax": 20,
          "watchdog": 6,
          "reloadOncePerMin": 10
        }
      },
      "render": {
        "fov": 74,
        "maxPixelRatio": 2,
        "shadows": true,
        "shadowMapSize": 2048,
        "bloom": true,
        "bloomStrength": 0.35,
        "bloomRadius": 0.4,
        "bloomThreshold": 0.62,
        "fxaa": true,
        "exposure": 1.05,
        "fogNear": 50,
        "fogFar": 150,
        "mobile": {
          "maxPixelRatio": 1.75,
          "shadowMapSize": 1024,
          "bloomStrength": 0.3,
          "anisotropy": 4,
          "ssao": false,
          "jetLight": false,
          "fxMaxParticles": 120
        },
        "textures": true,
        "jetLight": true,
        "fxMaxParticles": 400,
        "anisotropy": 8,
        "vignette": 0.35,
        "ssao": false,
        "props": true,
        "hdrBuffer": true,
        "city": {
          "fullIn": 100,
          "fullOut": 124,
          "lodIn": 640,
          "lodOut": 760,
          "interiorDist": 45,
          "propDist": 80,
          "treeDist": 70,
          "propEmissive": 2,
          "windowEmissive": 1.4,
          "farWindowGlow": 1.25,
          "farWindowLit": 1,
          "buildMsPerFrame": 4,
          "buildStepMs": 2,
          "buildFill": true,
          "maxFullPerFrame": 2,
          "detailBoost": 1.5,
          "lodBoost": 1.5,
          "boostNear": 40,
          "boostNearLod": 100,
          "stepBoxes": 64,
          "stepBoxCheck": 8,
          "stepRamps": 16,
          "stepItems": 8,
          "decorYield": 0.5,
          "lodShare": 0,
          "lodShareAfter": 2,
          "lodShareCap": 2,
          "primeMs": 1500,
          "cacheChunks": 40,
          "navRadius": 1,
          "navOpsWalk": 2,
          "navMsWalk": 4,
          "prefetchRadius": 2,
          "warmMaterials": true,
          "shadowCasters": true,
          "shadowRadius": 60,
          "shadowDistance": 500,
          "shadowFar": 1100,
          "hemiIntensity": 1,
          "landSpecular": 0.2,
          "landmarks": true,
          "props": true,
          "water": true,
          "billboards": true,
          "textureMax": {
            "normal": 1024,
            "orm": 1024,
            "emissive": 1024,
            "interior": 1024,
            "glbDetail": 1024
          },
          "altitude": [
            {
              "y": 0,
              "near": 0.15,
              "far": 2200,
              "fogNear": 250,
              "fogFar": 1300
            },
            {
              "y": 60,
              "near": 0.3,
              "far": 2800,
              "fogNear": 350,
              "fogFar": 1900
            },
            {
              "y": 160,
              "near": 0.6,
              "far": 4000,
              "fogNear": 500,
              "fogFar": 3000
            },
            {
              "y": 600,
              "near": 2,
              "far": 7500,
              "fogNear": 1000,
              "fogFar": 7000
            }
          ],
          "mobile": {
            "buildMsPerFrame": 6,
            "propDist": 60,
            "treeDist": 50,
            "lodIn": 560,
            "lodOut": 680,
            "interiorDist": 35,
            "cacheChunks": 40,
            "prefetchRadius": 1,
            "navMsWalk": 3,
            "propsGlbCrate": false,
            "textureMax": {
              "albedo": 1024,
              "normal": 512,
              "orm": 512,
              "emissive": 512,
              "interior": 512,
              "glb": 1024,
              "glbDetail": 512
            }
          }
        }
      },
      "audio": {
        "master": 0.8,
        "sfx": 1,
        "music": 0.45,
        "ambience": 0.6,
        "footstepDistance": 0.42,
        "footstepInterval": 0.5,
        "whizzDistance": 1.5,
        "ambienceName": "ambience_dusk",
        "musicName": "music_combat",
        "maxVoices": 32,
        "maxVoicesMobile": 20,
        "perNameMax": 4,
        "minInterval": 0.025,
        "minGain": 0.02,
        "listenerHz": 30,
        "engineHz": 15,
        "latencyHint": "interactive",
        "limiter": {
          "threshold": -2,
          "knee": 0,
          "ratio": 20,
          "attack": 0.003,
          "release": 0.25
        },
        "limits": {
          "casing": {
            "max": 2,
            "interval": 0.05
          },
          "whizz": {
            "max": 2,
            "interval": 0.06
          },
          "hitmarker": {
            "max": 2,
            "interval": 0.04
          },
          "hurt": {
            "max": 2,
            "interval": 0.08
          },
          "*_tail": {
            "max": 2
          },
          "*_fire": {
            "max": 4,
            "interval": 0.02
          },
          "impact_*": {
            "max": 3
          },
          "footstep_*": {
            "max": 2
          },
          "reload_*": {
            "max": 1
          },
          "flare_pop": {
            "max": 3,
            "interval": 0.06
          },
          "cannon_m61": {
            "max": 2
          },
          "missile_loop": {
            "max": 4
          },
          "missile_explode": {
            "max": 3
          },
          "jet_flyby": {
            "max": 1,
            "interval": 1.5
          },
          "lock_tone": {
            "max": 1
          },
          "lock_solid": {
            "max": 1
          },
          "rwr_warning": {
            "max": 1
          },
          "sonic_boom": {
            "max": 1,
            "interval": 3
          },
          "catapult_launch": {
            "max": 1
          },
          "arrest_catch": {
            "max": 1
          }
        }
      },
      "online": {
        "server": "",
        "maxPlayers": 8,
        "respawnDelay": 3,
        "city": {
          "areaRadius": 450,
          "rotateMinutes": 15,
          "rotateWarning": 30,
          "outsideDps": 8,
          "interest": 600,
          "interestAir": 1500,
          "fireRange": 700,
          "propAllowance": 4.5,
          "fallLag": 1,
          "chunkBuilds": 1,
          "chunkCache": 200
        },
        "royale": {
          "minPlayers": 2,
          "countdown": 20,
          "resultTime": 15,
          "lobbyZone": "gct",
          "startR": 1200,
          "centerJitter": 250,
          "phases": [
            {
              "wait": 75,
              "shrink": 60,
              "r": 700,
              "dps": 2
            },
            {
              "wait": 60,
              "shrink": 50,
              "r": 380,
              "dps": 4
            },
            {
              "wait": 50,
              "shrink": 40,
              "r": 180,
              "dps": 7
            },
            {
              "wait": 40,
              "shrink": 35,
              "r": 70,
              "dps": 10
            },
            {
              "wait": 30,
              "shrink": 30,
              "r": 0,
              "dps": 15
            }
          ],
          "transport": {
            "enabled": true,
            "height": 420,
            "speed": 85,
            "margin": 250,
            "offset": 400
          },
          "forceJumpAfter": 2
        }
      },
      "vehicles": {
        "enterDistance": 3,
        "fovBoost": 6,
        "headlights": true,
        "headlightIntensity": 2.5,
        "headlightDistance": 30,
        "engineVolume": 0.8,
        "hornCooldown": 0.8,
        "types": {
          "jeep": {
            "name": "ジープ",
            "model": "models/jeep.glb",
            "fallback": "jeep",
            "scale": 1,
            "length": 4.35,
            "width": 2,
            "height": 1.83,
            "wheelRadius": 0.42,
            "wheelbase": 2.5,
            "track": 1.7,
            "health": 600,
            "armor": 1,
            "driverExposure": 0.35,
            "maxSpeed": 24,
            "maxReverse": 8,
            "accel": 8,
            "brake": 16,
            "drag": 0.08,
            "rolling": 1.5,
            "maxSteer": 34,
            "highSpeedSteer": 0.3,
            "steerSpeed": 5,
            "seat": [
              0.42,
              1.2,
              -0.15
            ],
            "exit": [
              2.3,
              0,
              -0.1
            ],
            "impactSpeed": 4,
            "impactDamage": 7,
            "runOverSpeed": 3,
            "explodeRadius": 7,
            "explodeDamage": 160,
            "respawn": 25,
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit"
              },
              {
                "seat": [
                  -0.42,
                  1.2,
                  -0.15
                ],
                "exit": [
                  -2.3,
                  0,
                  -0.1
                ]
              }
            ],
            "color": "#4a5137"
          },
          "pickup": {
            "name": "ピックアップ",
            "model": "models/pickup.glb",
            "fallback": "pickup",
            "scale": 1,
            "length": 5.3,
            "width": 2,
            "height": 1.9,
            "wheelRadius": 0.4,
            "wheelbase": 3.2,
            "track": 1.64,
            "health": 750,
            "armor": 1,
            "driverExposure": 0.2,
            "maxSpeed": 27,
            "maxReverse": 8,
            "accel": 7,
            "brake": 15,
            "drag": 0.08,
            "rolling": 1.4,
            "maxSteer": 30,
            "highSpeedSteer": 0.3,
            "steerSpeed": 4.5,
            "seat": [
              0.42,
              1.34,
              0.1
            ],
            "exit": [
              2.22,
              0,
              0.3
            ],
            "impactSpeed": 4,
            "impactDamage": 6,
            "runOverSpeed": 3,
            "explodeRadius": 7.5,
            "explodeDamage": 170,
            "respawn": 30,
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit"
              },
              {
                "seat": [
                  -0.42,
                  1.34,
                  0.1
                ],
                "exit": [
                  -2.22,
                  0,
                  0.3
                ]
              },
              {
                "seat": [
                  0.5,
                  1.85,
                  -1.55
                ],
                "exit": [
                  2,
                  0,
                  -1.6
                ]
              },
              {
                "seat": [
                  -0.5,
                  1.85,
                  -1.55
                ],
                "exit": [
                  -2,
                  0,
                  -1.6
                ]
              }
            ],
            "color": "#2f3a44"
          },
          "apc": {
            "name": "装甲車",
            "model": "models/apc.glb",
            "fallback": "apc",
            "scale": 1,
            "length": 6.55,
            "width": 2.79,
            "height": 2.5,
            "wheelRadius": 0.55,
            "wheelbase": 3.95,
            "track": 2.28,
            "health": 1800,
            "armor": 0.35,
            "driverExposure": 0.1,
            "maxSpeed": 18,
            "maxReverse": 6,
            "accel": 5,
            "brake": 12,
            "drag": 0.08,
            "rolling": 1.2,
            "maxSteer": 26,
            "highSpeedSteer": 0.4,
            "steerSpeed": 3.5,
            "seat": [
              0.45,
              2.75,
              1.3
            ],
            "exit": [
              2.58,
              0,
              1.35
            ],
            "impactSpeed": 4,
            "impactDamage": 3,
            "runOverSpeed": 2.5,
            "explodeRadius": 9,
            "explodeDamage": 200,
            "respawn": 40,
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit"
              },
              {
                "seat": [
                  -0.45,
                  2.75,
                  1.3
                ],
                "exit": [
                  -2.58,
                  0,
                  1.35
                ]
              },
              {
                "seat": [
                  0.6,
                  2.75,
                  -1.7
                ],
                "exit": [
                  2.6,
                  0,
                  -1.7
                ]
              },
              {
                "seat": [
                  -0.6,
                  2.75,
                  -1.7
                ],
                "exit": [
                  -2.6,
                  0,
                  -1.7
                ]
              }
            ],
            "color": "#8a7a55",
            "seatFromConfig": true
          },
          "heli": {
            "name": "ヘリ",
            "kind": "heli",
            "model": "models/helicopter.glb",
            "fallback": "heli",
            "scale": 1,
            "length": 10.6,
            "width": 2.32,
            "height": 3.45,
            "health": 1000,
            "armor": 0.6,
            "driverExposure": 0.25,
            "maxSpeed": 45,
            "maxBackward": 14,
            "maxStrafe": 18,
            "accel": 8,
            "brake": 11,
            "easeSpeed": 4,
            "climbRate": 9,
            "descendRate": 8,
            "vAccel": 12,
            "vBrake": 18,
            "maxAltitude": 220,
            "ceilingMargin": 35,
            "ceilingRadius": 70,
            "boundsMargin": 80,
            "yawFollow": 2.4,
            "maxYawRate": 80,
            "yawAccel": 260,
            "tiltGain": 0.55,
            "cruisePitch": 7,
            "pitchMax": 18,
            "rollMax": 24,
            "tiltRate": 3.5,
            "spinUpTime": 3,
            "liftRpm": 0.9,
            "spinDownTime": 9,
            "rotorRev": 6.5,
            "tailRatio": 5,
            "groundEffect": 7,
            "touchdownSpeed": 1.3,
            "stepUp": 0.45,
            "landingSpeed": 5,
            "landingDamage": 45,
            "landingSlope": 0.25,
            "landingMaxSpeed": 8,
            "skidFriction": 6,
            "impactSpeed": 4,
            "impactDamage": 14,
            "rotorStrike": 1.3,
            "bounce": 0.35,
            "collisionSpin": 0.5,
            "explodeRadius": 10,
            "explodeDamage": 220,
            "respawn": 45,
            "floatTime": 4,
            "sinkTime": 4,
            "autoHoverTime": 2.5,
            "autoDescend": 3,
            "washHeight": 15,
            "hoverBob": 0.035,
            "wreckGravity": 14,
            "cameraRoll": 0.25,
            "chaseDistance": 11,
            "chaseHeight": 2.2,
            "chaseSpeedDist": 4,
            "navOpsPerFrame": 1,
            "seat": [
              -0.42,
              1.92,
              1
            ],
            "exit": [
              -1.85,
              0,
              1
            ],
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit_driver",
                "seat": [
                  -0.42,
                  1.92,
                  1
                ],
                "exit": [
                  -1.85,
                  0,
                  1
                ]
              },
              {
                "node": "seat_p1",
                "exitNode": "exit_p1",
                "seat": [
                  0.42,
                  1.92,
                  1
                ],
                "exit": [
                  1.85,
                  0,
                  1
                ]
              },
              {
                "node": "seat_p2",
                "exitNode": "exit_p2",
                "seat": [
                  0.4,
                  1.89,
                  -0.95
                ],
                "exit": [
                  1.85,
                  0,
                  -0.95
                ]
              },
              {
                "node": "seat_p3",
                "exitNode": "exit_p3",
                "seat": [
                  -0.4,
                  1.89,
                  -0.95
                ],
                "exit": [
                  -1.85,
                  0,
                  -0.95
                ]
              }
            ],
            "color": "#1f2f4d"
          },
          "jet": {
            "name": "F/A-18F",
            "kind": "jet",
            "model": "models/fa18.glb",
            "fallback": "jet",
            "scale": 1,
            "length": 18.27,
            "width": 13.65,
            "height": 5.15,
            "wheelRadius": 0.387,
            "noseWheelRadius": 0.288,
            "wheelbase": 6.07,
            "track": 3.03,
            "cg": [
              0,
              1.95,
              0.62
            ],
            "health": 900,
            "armor": 0.5,
            "driverExposure": 0,
            "maxSpeed": 250,
            "thrustMil": 6.8,
            "thrustAB": 11.5,
            "idleThrust": 0.3,
            "spoolTime": 1.1,
            "abTime": 0.35,
            "startTime": 2.5,
            "spinDownTime": 5,
            "inducedDrag": 45,
            "gearDrag": 1,
            "airbrakeDrag": 1.6,
            "overspeedDrag": 6,
            "stallSpeed": 65,
            "stallSpeedLanding": 55,
            "stallBand": 10,
            "landingLift": 1.15,
            "cornerSpeed": 150,
            "gLimit": 7.5,
            "gMin": -2.5,
            "stallAoA": 18,
            "rollRate": 220,
            "rollAccel": 1100,
            "pitchTrack": 7,
            "maxPitchRate": 70,
            "yawRate": 10,
            "sideslipDamp": 2.2,
            "sideForce": 0.025,
            "ceiling": 2500,
            "ceilingSoft": 300,
            "boundsMargin": 250,
            "throttleRate": 0.7,
            "throttleRateFull": 1.4,
            "throttleRateDown": 1.4,
            "throttleRateCut": 4,
            "stickDeadzone": 0.12,
            "abStick": 0.85,
            "idleBrake": -0.8,
            "abHold": 0.2,
            "rotateSpeed": 66,
            "rotateAoA": 11,
            "rotateRate": 7,
            "rotatePitch": 2,
            "liftoffPitch": 2,
            "liftoffLift": 1.02,
            "lowerRate": 4,
            "taxiFriction": 0.35,
            "brake": 9,
            "noseSteer": 55,
            "steerFadeSpeed": 25,
            "rudderGround": 10,
            "touchdownSpeed": 85,
            "touchdownSink": 6,
            "touchdownRoll": 15,
            "touchdownPitch": -4,
            "crashSpeed": 14,
            "impactDamage": 18,
            "bounce": 0.15,
            "catSpeed": 75,
            "catTension": 0.6,
            "catSnapRadius": 14,
            "catSnapSpeed": 4,
            "catSnapAngle": 50,
            "catAlignTime": 1.4,
            "catThrottle": 0.98,
            "catSoundTime": 2.4,
            "arrestTime": 1.85,
            "arrestHold": 1,
            "hookAutoRange": 2500,
            "hookAutoAngle": 40,
            "wireHeight": 0.9,
            "bolterHeight": 8,
            "bolterClear": 40,
            "rearmTime": 3,
            "gearTime": 1.5,
            "autoGear": true,
            "autoGearAgl": 25,
            "autoGearSpeed": 85,
            "canopyTime": 2.2,
            "hookTime": 1.2,
            "gun": {
              "rate": 50,
              "ammo": 578,
              "damage": 30,
              "range": 1600,
              "convergence": 650,
              "spread": 0.3,
              "tracerEvery": 3,
              "burst": 0.6,
              "tracerSpeed": 1050
            },
            "explodeRadius": 18,
            "explodeDamage": 400,
            "explodeFx": 7,
            "explodeFxCount": 0.6,
            "wreckSmokeEvery": 0.2,
            "respawn": 60,
            "wreckGravity": 12,
            "pilotlessDive": 0.6,
            "pilotlessTime": 45,
            "pilotlessCtl": {
              "rollFrac": 0.5,
              "levelGain": 2,
              "turnGain": 3,
              "turnBank": 1.5,
              "maxBank": 69
            },
            "chaseDistance": 24,
            "chaseHeight": 5,
            "chaseSpeedDist": 10,
            "chaseFovBoost": 12,
            "cockpitFovBoost": 5,
            "chaseLift": 16,
            "camAssist": {
              "goalRate": 3,
              "followRate": 1.6,
              "swipePause": 0.6,
              "hookTime": 2.5,
              "launchTime": 1.5,
              "levelAfter": 8,
              "levelPitch": 3
            },
            "hud": {
              "tutorialTime": 10,
              "climbHintTime": 5
            },
            "aim": {
              "rollGain": 4,
              "pitchGain": 2.4,
              "yawGain": 1.4,
              "levelFrom": 1.5,
              "levelTo": 9,
              "pushMax": 18,
              "groundSteer": 2.5,
              "turnDamp": 0.6,
              "bankMargin": 8,
              "invertOff": 30,
              "lowBank": 10,
              "lowAgl": 40,
              "groundWarn": 3,
              "stickRoll": 0.5,
              "stickAngle": 1,
              "groundStick": 0.3,
              "groundAngle": 1,
              "autoRotate": 8,
              "autoRotateThrottle": 0.9,
              "autoRotateMinPitch": -3,
              "floorAgl": 25,
              "floorPitch": 10,
              "nearTau": 1,
              "lookTime": 8,
              "lookStep": 12,
              "lookMax": 60,
              "lookEvery": 0.1,
              "lookSide": 0.5,
              "boxNear": 300,
              "boxTime": 2.5,
              "boxStep": 64,
              "boxSide": 6,
              "arcMax": 2,
              "arcMin": 0.03,
              "escFrom": 15,
              "escSpeedK": 1.6,
              "escGain": 10,
              "escHold": 2,
              "climbMax": 60,
              "pullFrac": 0.6,
              "pullSafety": 2,
              "pullReact": 1,
              "landingMargin": 10,
              "landingSlope": 8,
              "speedFloor": 12,
              "spdPitchMin": 3,
              "spdPitchMax": 10,
              "arcRescan": 0.25,
              "avoidGFrom": 3,
              "avoidGFull": 20,
              "turnBlockFrom": 5,
              "turnBlockFull": 15,
              "landNear": 200,
              "landBoxSide": 2,
              "landClear": 8,
              "landStep": 3
            },
            "deck": {
              "assistStick": 0.5,
              "cancelStick": -0.3,
              "brakeStick": -0.5,
              "taxiMax": 35,
              "taxiAccel": 8,
              "taxiDecel": 9,
              "routeDecel": 0.65,
              "endSpeed": 1,
              "speedGain": 2.5,
              "cornerAccel": 4,
              "cornerMin": 3,
              "cornerLook": 80,
              "offRouteAngle": 29,
              "offRouteSpeed": 5,
              "lookahead": 6,
              "lookaheadSpeed": 0.35,
              "manualMax": 12,
              "hookDist": 2.5,
              "startSpin": 0.3,
              "stuckTime": 2,
              "routeEvery": 0.5,
              "routeRefresh": 3,
              "retryEvery": 1.5,
              "msgEvery": 3,
              "joinSlope": 1.3,
              "joinMin": 8,
              "maxTurn": 100,
              "kickDist": 5,
              "kickMin": 15,
              "kickMax": 60,
              "kickGain": 1.5,
              "checkStep": 1,
              "checkNear": 4,
              "jetGap": 0.5,
              "unhookHold": 2,
              "unhookCool": 4,
              "launchThrottle": 2,
              "alignTime": 0.7,
              "spoolDist": 40,
              "autoThrottle": [
                0.3,
                0.8,
                0.9
              ],
              "guardMargin": 2.5,
              "guardStep": 0.4,
              "reverseMax": 3,
              "reverseAccel": 2,
              "reverseHold": 0.8,
              "backTol": 0.25,
              "backEndSpeed": 0.2,
              "captureDist": 40,
              "captureLat": 6,
              "captureFar": 0.5,
              "captureAngle": 35,
              "captureEvery": 0.25,
              "captureSpeed": 1,
              "recoverBack": [
                3,
                6,
                10,
                15,
                20,
                30,
                40,
                55,
                70
              ],
              "recoverArc": [
                4,
                8,
                12,
                16
              ],
              "recoverFwd": [
                3,
                6
              ],
              "recoverFwdSteer": [
                0,
                0.5,
                -0.5,
                1,
                -1
              ],
              "towHold": 3,
              "recoverAlignSteer": 0.5,
              "recoverAlignMin": 3,
              "recoverAlignMax": 20,
              "towBack": [
                14,
                24,
                34
              ],
              "clearTime": 90,
              "clearBehind": 8,
              "clearLat": 6,
              "clearWait": 3,
              "waitPing": 0.5,
              "laneOffsets": [
                4,
                7,
                -4
              ],
              "laneMerge": 25,
              "laneRamp": 20,
              "reverseStart": 0.3,
              "movingSpeed": 0.05,
              "catThrottleRate": 2,
              "catThrottleMin": 0.5,
              "stopSpeed": 0.2,
              "backStopSpeed": 0.1,
              "resumeDist": 1.5,
              "resumeAngle": 10,
              "releaseBrake": 0.2,
              "holdSpeed": 0.3,
              "clearMoved": 3,
              "heightTol": 0.6,
              "busyStep": 6,
              "overlapSkip": 3,
              "topClear": 0.35,
              "boxReach": 1,
              "otherReach": 30,
              "otherHeight": 2,
              "snapReach": 500,
              "stillSpeed": 0.5,
              "routeMove": 0.3,
              "routeTurn": 1.15,
              "releaseMag": 0.15,
              "stuckAcc": 0.5,
              "stuckSpeed": 0.3,
              "progressDist": 1,
              "simStep": 0.05,
              "simTime": 120,
              "simStopSpeed": 0.05,
              "hookThrottle": 0.3,
              "hookSpeedMul": 1.5,
              "joinSlopeAlt": [
                0.5,
                0.8,
                2,
                3
              ],
              "laneStep": 1,
              "snapBehind": 1,
              "overlapTol": 0.02,
              "pushEps": 0.02,
              "guardGap": 0.3,
              "guardMinDecel": 1,
              "liveEvery": 0.1,
              "liveMove": 0.3,
              "liveTurn": 3,
              "landedClearTime": 10,
              "foulLane": 6,
              "foulPad": 1,
              "foulHeight": 3,
              "spotPlayerClear": 9,
              "foulEvery": 0.25,
              "headSpeed": 1.5,
              "headDist": 160,
              "headAngle": 12,
              "headMargin": 6
            },
            "climb": {
              "time": 4,
              "maxTime": 10,
              "agl": 120,
              "pitch": 12,
              "pitchMax": 25,
              "yaw": 30,
              "boundsPitch": 8,
              "boundsAgl": 200,
              "throttle": 1
            },
            "boundsHold": 45,
            "boundsExit": 25,
            "boundsLatchMove": 20,
            "boundsTurnG": 12,
            "boundsMarginMax": 600,
            "boundsTurnK": 2.2,
            "boundsUse": 0.7,
            "boundsLead": 0.8,
            "maxG": 200,
            "minG": -20,
            "gOnsetRate": 120,
            "maneuver": {
              "fromSpeed": 95,
              "fullSpeed": 240,
              "liftMargin": 1.06,
              "drag": 0.006,
              "aimFrom": 25,
              "aimFull": 100,
              "stickFrom": 0.55,
              "curve": 1.6,
              "release": 2,
              "blendG": 2,
              "rollRateMax": 400,
              "rollGainBoost": 1.5,
              "pitchMargin": 1.3,
              "trackBoost": 4,
              "rollingErr": 4,
              "integrateAbove": 1.05,
              "maxStepTurn": 0.03,
              "maxSteps": 16,
              "sweepTurn": 0.15,
              "bankMarginMin": 2,
              "peakDecay": 0.5
            },
            "easy": {
              "deadzone": 0.12,
              "stickCurve": 1.6,
              "gFrom": 0.3,
              "gCurve": 1.2,
              "turnLead": 120,
              "climbAngle": 40,
              "diveAngle": 35,
              "climbBand": 30,
              "altLead": 1,
              "yawLead": 0.25,
              "holdTau": 3,
              "holdMaxPitch": 12,
              "holdPitchLag": 8,
              "cruiseSpeed": 139,
              "turnSpeed": 125,
              "minSpeed": 95,
              "landingMinSpeed": 62,
              "throttleBase": 0.55,
              "throttleGain": 0.08,
              "throttleI": 0.02,
              "throttleIMax": 0.3,
              "throttleRate": 2,
              "abMargin": 25,
              "airbrakeOver": 35,
              "gearDist": 3000,
              "gearAgl": 400,
              "gearSpeed": 120,
              "gearSlow": 100,
              "gearUpSpeed": 125,
              "gearUpAgl": 80,
              "stripLat": 120,
              "stripAngle": 30
            },
            "easyCam": {
              "rate": 3,
              "maxRate": 160,
              "pitchK": 0.6,
              "pitch": -4,
              "lookDelay": 1.2,
              "lookReturn": 1.5
            },
            "autoland": {
              "carrierRange": 4000,
              "roadRange": 6000,
              "step": 25,
              "lat": 18,
              "clear": 22,
              "noClear": 350,
              "descent": 11,
              "climb": 8,
              "outDist": 3000,
              "outAlt": 300,
              "outTau": 3,
              "outPitch": 15,
              "abortPast": 100,
              "interceptAbort": 1100,
              "interceptAbortK": 0.55,
              "finalLat": 60,
              "finalAngle": 25,
              "abortLat": 160,
              "abortAngle": 70,
              "leadK": 0.45,
              "leadMin": 140,
              "leadMax": 600,
              "gearDist": 2500,
              "slowDist": 2300,
              "cruise": 115,
              "belowK": 1,
              "trackDist": 700,
              "trackTau": 1.4,
              "trackTauLow": 1,
              "trackI": 0.5,
              "trackIMax": 3,
              "trackIWin": 1.5,
              "bolterClimb": 8,
              "cancelStick": 0.35,
              "boundsPad": 450,
              "rollBrake": 1,
              "vLeadMin": 150,
              "vLeadTime": 2.5,
              "maxDive": 14,
              "maxClimb": 20,
              "foulWaveOff": 900,
              "goShort": 300,
              "goCap": 300,
              "goHigh": 25,
              "goSteep": 12,
              "goHighShort": 5,
              "goHighK": 0.03,
              "goLat": 14,
              "goFast": 4,
              "goClimb": 10,
              "goAlt": 120,
              "goMin": 3,
              "goTime": 14,
              "flareSink": 5,
              "flareK": 0.3,
              "dubinsK": 1.25,
              "dubinsEvery": 0.5,
              "pathPad": 100,
              "lookTime": 2.5,
              "lookMin": 250,
              "gateAbove": 25,
              "outSlope": 6,
              "joinOutPad": 200,
              "vfAngle": 80,
              "vfK": 1,
              "vfMin": 250,
              "joinMin": 1300,
              "joinOver": 600,
              "lateK": 2.5,
              "maxTries": 4,
              "roads": [
                {
                  "name": "ウエストサイドハイウェイ",
                  "x": -2000,
                  "z": 300,
                  "yaw": 180,
                  "length": 1200
                }
              ]
            },
            "missile": {
              "count": 4,
              "reloadTime": 40,
              "lockCone": 22,
              "lockRange": 3000,
              "lockMin": 150,
              "lockTime": 0.8,
              "lockKeep": 30,
              "lockClear": 6,
              "lockHide": 0.6,
              "lockScan": 0.25,
              "cooldown": 0.6,
              "speed": 480,
              "accel": 220,
              "ejectSpeed": 15,
              "motorTime": 3.5,
              "coastDrag": 40,
              "dropTime": 0.25,
              "armTime": 0.35,
              "life": 9,
              "turnG": 55,
              "fuse": 9,
              "loftFrom": 400,
              "loftK": 0.5,
              "loftMax": 300,
              "losEvery": 0.1,
              "losClear": 4,
              "liftRate": 120,
              "blastRadius": 16,
              "damage": 650,
              "blastEdge": 0.6,
              "playerBlast": 0.3,
              "trailEvery": 0.05,
              "decoyRange": 2500,
              "decoyChance": 0.8,
              "flareLife": 3.2,
              "maxFlares": 18
            },
            "flares": {
              "count": 30,
              "burst": 3,
              "cooldown": 1.2,
              "autoRange": 1800,
              "autoTime": 3.5,
              "reloadTime": 8,
              "rwrEvery": 1
            },
            "gunAssist": {
              "cone": 9,
              "range": 1500
            },
            "gEffect": {
              "from": 9,
              "full": 150,
              "fovSqueeze": 7,
              "vignette": 0.5,
              "warnG": 30,
              "hotG": 120,
              "rate": 4
            },
            "ejectSpeed": 20,
            "ejectMaxHorizontal": 40,
            "ejectMaxVy": 10,
            "ejectArmTime": 2,
            "flybyRange": 160,
            "shadowAgl": 25,
            "navLeadMax": 300,
            "navLeadAgl": 400,
            "navOpsPerFrame": 1,
            "approach": {
              "glideSlope": 3.5,
              "speed": 70,
              "range": 4000
            },
            "seat": [
              0,
              3.06,
              6.42
            ],
            "exit": [
              2.2,
              0,
              6
            ],
            "seats": [
              {
                "node": "seat_pilot",
                "exitNode": "exit_l",
                "seat": [
                  0,
                  3.06,
                  6.42
                ],
                "exit": [
                  2.2,
                  0,
                  6
                ]
              },
              {
                "node": "seat_wso",
                "exitNode": "exit_r",
                "seat": [
                  0,
                  3.18,
                  4.88
                ],
                "exit": [
                  -2.2,
                  0,
                  6
                ]
              }
            ],
            "color": "#5f676e"
          }
        }
      }
    },
    "levels/arena01.json": {
      "id": "arena01",
      "name": "Dusk Outpost",
      "size": 100,
      "seed": 12345,
      "clearRadius": 8,
      "roadWidth": 7,
      "wallHeight": 4,
      "props": {
        "buildings": 7,
        "containers": 10,
        "barriers": 16,
        "sandbags": 8,
        "crates": 14,
        "barrels": 10
      },
      "sky": {
        "zenith": "#1d3358",
        "horizon": "#e9985a",
        "ground": "#3a2e2a",
        "sunColor": "#ffd9a8",
        "sunDir": [
          -0.55,
          0.3,
          -0.45
        ],
        "sunIntensity": 2.2,
        "background": "sky/dusk_bg.jpg",
        "env": "sky/dusk_env.jpg"
      },
      "playerStart": [
        0,
        0,
        180
      ],
      "spawnPoints": [
        [
          36,
          36
        ],
        [
          -36,
          36
        ],
        [
          36,
          -36
        ],
        [
          -36,
          -36
        ],
        [
          0,
          43
        ],
        [
          43,
          0
        ],
        [
          0,
          -43
        ],
        [
          -43,
          0
        ]
      ],
      "vehicles": [
        {
          "type": "jeep",
          "x": 1.6,
          "z": 13,
          "yaw": 180
        },
        {
          "type": "pickup",
          "x": -18,
          "z": 1.6,
          "yaw": 90
        },
        {
          "type": "apc",
          "x": 1.4,
          "z": -27,
          "yaw": 0
        }
      ],
      "boxes": null
    },
    "levels/midtown.json": {
      "id": "midtown",
      "name": "Midtown",
      "seed": 4242,
      "bounds": {
        "minX": -2900,
        "maxX": 3100,
        "minZ": -3000,
        "maxZ": 3000
      },
      "chunkSize": 128,
      "superChunk": 512,
      "maxOverhang": 64,
      "waterY": -2,
      "bedY": -14,
      "sky": {
        "zenith": "#1d3358",
        "horizon": "#e9985a",
        "ground": "#3a2e2a",
        "sunColor": "#ffd9a8",
        "sunDir": [
          -0.55,
          0.3,
          -0.45
        ],
        "sunIntensity": 1.8,
        "background": "sky/dusk_bg.jpg",
        "env": "sky/dusk_env.jpg"
      },
      "engine": {
        "stepUp": 0.45,
        "headroom": 1.8,
        "agentRadius": 0.45,
        "hashCell": 8,
        "graphCell": 1,
        "maxExpand": 20000,
        "parkCell": 32
      },
      "grid": {
        "streetZ0": 42,
        "streetSpacing": 80,
        "streetMin": 5,
        "streetMax": 79,
        "streetWidth": 18,
        "wideWidth": 30,
        "wide": [
          14,
          23,
          34,
          42,
          57,
          72,
          79
        ],
        "sidewalk": 5,
        "curbH": 0.15
      },
      "avenues": [
        {
          "id": "12",
          "x": -2000,
          "w": 36
        },
        {
          "id": "11",
          "x": -1780,
          "w": 26
        },
        {
          "id": "10",
          "x": -1510,
          "w": 26
        },
        {
          "id": "9",
          "x": -1240,
          "w": 26
        },
        {
          "id": "8",
          "x": -970,
          "w": 28
        },
        {
          "id": "7",
          "x": -720,
          "w": 26,
          "z0": -1369
        },
        {
          "id": "6",
          "x": -470,
          "w": 30,
          "z0": -1369
        },
        {
          "id": "5",
          "x": -220,
          "w": 26
        },
        {
          "id": "madison",
          "x": -110,
          "w": 22
        },
        {
          "id": "park",
          "x": 0,
          "w": 34,
          "median": 6
        },
        {
          "id": "lex",
          "x": 130,
          "w": 22
        },
        {
          "id": "3",
          "x": 290,
          "w": 26
        },
        {
          "id": "2",
          "x": 440,
          "w": 26
        },
        {
          "id": "1",
          "x": 590,
          "w": 30
        },
        {
          "id": "york",
          "x": 690,
          "w": 22,
          "z1": -1369
        },
        {
          "id": "a",
          "x": 760,
          "w": 22,
          "z0": 2225
        }
      ],
      "fdr": {
        "w": 24,
        "offset": 8
      },
      "roadGaps": [
        {
          "id": "gct_park",
          "rect": [
            -17,
            -231,
            17,
            -15
          ]
        },
        {
          "id": "gct_43",
          "rect": [
            -99,
            -89,
            119,
            -71
          ]
        },
        {
          "id": "gct_44",
          "rect": [
            -99,
            -169,
            119,
            -151
          ]
        },
        {
          "id": "bryant_41",
          "rect": [
            -455,
            71,
            -233,
            89
          ]
        },
        {
          "id": "rock_49",
          "rect": [
            -455,
            -569,
            -233,
            -551
          ]
        },
        {
          "id": "rock_50",
          "rect": [
            -455,
            -649,
            -233,
            -631
          ]
        },
        {
          "id": "madsq_24",
          "rect": [
            -207,
            1431,
            -121,
            1449
          ]
        },
        {
          "id": "madsq_25",
          "rect": [
            -207,
            1351,
            -121,
            1369
          ]
        },
        {
          "id": "hy_31",
          "rect": [
            -1767,
            871,
            -1523,
            889
          ]
        },
        {
          "id": "hy_32",
          "rect": [
            -1767,
            791,
            -1523,
            809
          ]
        },
        {
          "id": "hy_33",
          "rect": [
            -1767,
            711,
            -1523,
            729
          ]
        },
        {
          "id": "yard_31",
          "rect": [
            -1982,
            871,
            -1793,
            889
          ]
        },
        {
          "id": "yard_32",
          "rect": [
            -1982,
            791,
            -1793,
            809
          ]
        },
        {
          "id": "yard_33",
          "rect": [
            -1982,
            711,
            -1793,
            729
          ]
        },
        {
          "id": "un_43_47",
          "rect": [
            605,
            -471,
            760,
            -15
          ]
        },
        {
          "id": "cpark",
          "rect": [
            -956,
            -3000,
            -233,
            -1369
          ]
        }
      ],
      "broadway": {
        "w": 24,
        "pts": [
          [
            -60,
            3000
          ],
          [
            -60,
            1880
          ],
          [
            -150,
            1600
          ],
          [
            -220,
            1470
          ],
          [
            -470,
            640
          ],
          [
            -720,
            -240
          ],
          [
            -970,
            -1360
          ],
          [
            -1240,
            -1840
          ],
          [
            -1510,
            -2400
          ],
          [
            -1560,
            -3000
          ]
        ],
        "plazaZ": [
          [
            -410,
            10
          ]
        ]
      },
      "shores": {
        "west": [
          [
            -3000,
            -2060
          ],
          [
            3000,
            -2060
          ]
        ],
        "east": [
          [
            -3000,
            820
          ],
          [
            -1360,
            760
          ],
          [
            -640,
            740
          ],
          [
            0,
            700
          ],
          [
            640,
            720
          ],
          [
            2240,
            860
          ],
          [
            3000,
            900
          ]
        ],
        "queens": [
          [
            -3000,
            1050
          ],
          [
            3000,
            1050
          ]
        ]
      },
      "islands": [
        {
          "id": "roosevelt",
          "x0": 820,
          "x1": 960,
          "zTip": -700,
          "z1": -3000,
          "tipR": 70
        }
      ],
      "roosevelt": {
        "roadX": 890,
        "roadW": 16,
        "streetZ": [
          -900,
          -1150,
          -1650,
          -1900,
          -2150,
          -2400,
          -2650,
          -2900
        ],
        "streetW": 14,
        "promenade": 6,
        "parkZ": -860
      },
      "queens": {
        "avenues": [
          {
            "id": "vernon",
            "x": 1090,
            "w": 18
          },
          {
            "id": "q2",
            "x": 1250,
            "w": 22
          },
          {
            "id": "q3",
            "x": 1410,
            "w": 22
          },
          {
            "id": "q4",
            "x": 1580,
            "w": 30
          },
          {
            "id": "q5",
            "x": 1760,
            "w": 22
          },
          {
            "id": "q6",
            "x": 1940,
            "w": 22
          },
          {
            "id": "q7",
            "x": 2120,
            "w": 22
          },
          {
            "id": "q8",
            "x": 2300,
            "w": 22
          },
          {
            "id": "q9",
            "x": 2480,
            "w": 22
          },
          {
            "id": "q10",
            "x": 2660,
            "w": 22
          },
          {
            "id": "q11",
            "x": 2840,
            "w": 22
          },
          {
            "id": "q12",
            "x": 3020,
            "w": 22
          }
        ],
        "streetZ0": -1400,
        "streetSpacing": 100,
        "streetWidth": 16,
        "wideWidth": 30,
        "wide": [
          -1400,
          -400,
          600,
          1600
        ],
        "x0": 1050,
        "x1": 3100
      },
      "piers": {
        "hudson": {
          "from": 40,
          "to": 57,
          "x0": -2300,
          "x1": -2060,
          "w": 30,
          "skip": [
            47
          ]
        },
        "extra": [
          {
            "id": "heli_hudson",
            "x0": -2170,
            "x1": -2058,
            "z0": 935,
            "z1": 985,
            "mat": "concrete"
          },
          {
            "id": "heli_east",
            "x0": 716,
            "x1": 800,
            "z0": 615,
            "z1": 665,
            "mat": "concrete"
          },
          {
            "id": "lic_pier",
            "x0": 990,
            "x1": 1052,
            "z0": -310,
            "z1": -290
          },
          {
            "id": "ri_causeway",
            "x0": 958,
            "x1": 1052,
            "z0": -2306,
            "z1": -2294,
            "mat": "asphalt_city",
            "road": true
          }
        ]
      },
      "materials": {
        "storey": {
          "brick_brown": 3.6,
          "brick_red": 3.6,
          "glass_tower": 4,
          "office_stone": 4,
          "limestone": 4,
          "concrete": 3.6
        },
        "shell": {
          "brick_brown": "concrete",
          "brick_red": "concrete",
          "limestone": "limestone",
          "office_stone": "limestone",
          "glass_tower": "concrete",
          "concrete": "concrete"
        },
        "floors": [
          "wood_floor",
          "terrazzo",
          "carpet_office",
          "wood_floor"
        ],
        "roof": "gravel_roof",
        "interior": "plaster_interior",
        "stair": "stair_stone",
        "sidewalk": "sidewalk",
        "road": "asphalt_city"
      },
      "building": {
        "wall": 0.3,
        "slab": 0.25,
        "partition": 0.2,
        "sill": 1,
        "winH": 1.4,
        "winW": 1.2,
        "bay": 3,
        "doorW": 2,
        "doorH": 2.4,
        "parapet": 1,
        "bulkhead": 3,
        "stairT": 0.3,
        "maxSlope": 0.65,
        "minEnterW": 9,
        "minEnterD": 12,
        "maxEnterFloors": 7,
        "towerMinW": 20,
        "setbackMinH": 60,
        "partitionEvery": 16
      },
      "districts": [
        {
          "id": "approach",
          "rect": [
            -1982,
            -585,
            -760,
            -320
          ],
          "cap": {
            "x": -2115.88,
            "z": -349.54,
            "dx": 0.990268,
            "dz": -0.139173,
            "y": 15,
            "slope": 0.0612,
            "clear": 10,
            "latFree": 45,
            "latSlope": 0.5
          }
        },
        {
          "id": "hy",
          "rule": "hudson_yards",
          "rect": [
            -2000,
            640,
            -1240,
            1000
          ]
        },
        {
          "id": "west_ind",
          "rule": "industrial_west",
          "rect": [
            -2060,
            -1369,
            -1640,
            3000
          ]
        },
        {
          "id": "uws",
          "rule": "residential_west",
          "rect": [
            -2060,
            -3000,
            -956,
            -1369
          ]
        },
        {
          "id": "ues",
          "rule": "residential_east",
          "rect": [
            -233,
            -3000,
            900,
            -1369
          ]
        },
        {
          "id": "core",
          "rule": "midtown_core",
          "rect": [
            -1640,
            -1369,
            450,
            1200
          ]
        },
        {
          "id": "midtown_e",
          "rule": "residential_east",
          "rect": [
            450,
            -1369,
            900,
            1200
          ]
        },
        {
          "id": "chelsea",
          "rule": "residential_west",
          "rect": [
            -1640,
            1200,
            -470,
            3000
          ]
        },
        {
          "id": "gramercy",
          "rule": "residential_east",
          "rect": [
            -470,
            1200,
            950,
            3000
          ]
        },
        {
          "id": "roosevelt",
          "rule": "roosevelt",
          "rect": [
            800,
            -3000,
            980,
            -690
          ]
        },
        {
          "id": "lic",
          "rule": "queens_waterfront",
          "rect": [
            1040,
            -3000,
            1420,
            3000
          ]
        },
        {
          "id": "queens",
          "rule": "queens_lowrise",
          "rect": [
            1420,
            -3000,
            3100,
            3000
          ]
        }
      ],
      "rules": {
        "midtown_core": {
          "lot": [
            18,
            42
          ],
          "endLot": [
            22,
            34
          ],
          "alley": 0.12,
          "open": 0.04,
          "mix": {
            "tower": 0.42,
            "midrise": 0.38,
            "walkup": 0.14,
            "lowrise": 0.06
          },
          "tower": {
            "floors": [
              24,
              62
            ],
            "mats": [
              "glass_tower",
              "office_stone",
              "limestone",
              "glass_tower"
            ]
          },
          "midrise": {
            "floors": [
              8,
              22
            ],
            "mats": [
              "office_stone",
              "limestone",
              "brick_brown"
            ]
          },
          "walkup": {
            "floors": [
              4,
              7
            ],
            "mats": [
              "brick_brown",
              "brick_red",
              "limestone"
            ]
          },
          "lowrise": {
            "floors": [
              2,
              3
            ],
            "mats": [
              "limestone",
              "brick_red"
            ]
          },
          "enterable": 0.3,
          "lobby": 0.25,
          "tank": 0.2,
          "shed": 0.06,
          "trees": 0.25,
          "newsstand": 0.5,
          "parked": 0.35
        },
        "residential_east": {
          "lot": [
            9,
            24
          ],
          "endLot": [
            18,
            28
          ],
          "alley": 0.25,
          "open": 0.06,
          "mix": {
            "tower": 0.12,
            "midrise": 0.24,
            "walkup": 0.56,
            "lowrise": 0.08
          },
          "tower": {
            "floors": [
              16,
              40
            ],
            "mats": [
              "office_stone",
              "brick_brown",
              "glass_tower"
            ]
          },
          "midrise": {
            "floors": [
              8,
              16
            ],
            "mats": [
              "brick_brown",
              "brick_red",
              "office_stone"
            ]
          },
          "walkup": {
            "floors": [
              4,
              7
            ],
            "mats": [
              "brick_brown",
              "brick_red",
              "brick_red",
              "limestone"
            ]
          },
          "lowrise": {
            "floors": [
              2,
              3
            ],
            "mats": [
              "brick_red",
              "limestone"
            ]
          },
          "enterable": 0.3,
          "lobby": 0.15,
          "tank": 0.45,
          "shed": 0.05,
          "trees": 0.7,
          "newsstand": 0.15,
          "parked": 0.5
        },
        "residential_west": {
          "lot": [
            9,
            24
          ],
          "endLot": [
            18,
            28
          ],
          "alley": 0.3,
          "open": 0.07,
          "mix": {
            "tower": 0.08,
            "midrise": 0.22,
            "walkup": 0.6,
            "lowrise": 0.1
          },
          "tower": {
            "floors": [
              16,
              34
            ],
            "mats": [
              "brick_brown",
              "office_stone"
            ]
          },
          "midrise": {
            "floors": [
              8,
              15
            ],
            "mats": [
              "brick_red",
              "brick_brown",
              "limestone"
            ]
          },
          "walkup": {
            "floors": [
              4,
              7
            ],
            "mats": [
              "brick_red",
              "brick_brown",
              "brick_red"
            ]
          },
          "lowrise": {
            "floors": [
              2,
              3
            ],
            "mats": [
              "brick_red",
              "limestone"
            ]
          },
          "enterable": 0.32,
          "lobby": 0.1,
          "tank": 0.5,
          "shed": 0.04,
          "trees": 0.75,
          "newsstand": 0.1,
          "parked": 0.55
        },
        "industrial_west": {
          "lot": [
            20,
            46
          ],
          "endLot": [
            24,
            36
          ],
          "alley": 0.35,
          "open": 0.05,
          "mix": {
            "warehouse": 0.48,
            "parking": 0.16,
            "canopy": 0.05,
            "walkup": 0.19,
            "midrise": 0.12
          },
          "warehouse": {
            "floors": [
              1,
              2
            ],
            "floorH": 6,
            "mats": [
              "brick_red",
              "concrete"
            ]
          },
          "midrise": {
            "floors": [
              6,
              12
            ],
            "mats": [
              "brick_red",
              "concrete",
              "brick_brown"
            ]
          },
          "walkup": {
            "floors": [
              3,
              6
            ],
            "mats": [
              "brick_red",
              "brick_brown"
            ]
          },
          "enterable": 0.45,
          "lobby": 0,
          "tank": 0.4,
          "shed": 0.03,
          "trees": 0.2,
          "newsstand": 0,
          "parked": 0.6
        },
        "hudson_yards": {
          "lot": [
            24,
            46
          ],
          "endLot": [
            26,
            36
          ],
          "alley": 0.1,
          "open": 0.05,
          "mix": {
            "tower": 0.55,
            "midrise": 0.3,
            "warehouse": 0.15
          },
          "tower": {
            "floors": [
              30,
              70
            ],
            "mats": [
              "glass_tower",
              "glass_tower",
              "office_stone"
            ]
          },
          "midrise": {
            "floors": [
              8,
              18
            ],
            "mats": [
              "glass_tower",
              "concrete"
            ]
          },
          "warehouse": {
            "floors": [
              1,
              2
            ],
            "floorH": 6,
            "mats": [
              "concrete",
              "brick_red"
            ]
          },
          "enterable": 0.4,
          "lobby": 0.3,
          "tank": 0,
          "shed": 0.1,
          "trees": 0.3,
          "newsstand": 0.1,
          "parked": 0.3
        },
        "roosevelt": {
          "lot": [
            16,
            32
          ],
          "endLot": [
            18,
            30
          ],
          "alley": 0.4,
          "open": 0.12,
          "mix": {
            "midrise": 0.45,
            "walkup": 0.45,
            "tower": 0.1
          },
          "tower": {
            "floors": [
              14,
              22
            ],
            "mats": [
              "brick_brown",
              "concrete"
            ]
          },
          "midrise": {
            "floors": [
              8,
              14
            ],
            "mats": [
              "brick_brown",
              "brick_red",
              "concrete"
            ]
          },
          "walkup": {
            "floors": [
              3,
              6
            ],
            "mats": [
              "brick_red",
              "brick_brown"
            ]
          },
          "enterable": 0.4,
          "lobby": 0.2,
          "tank": 0.2,
          "shed": 0,
          "trees": 0.8,
          "newsstand": 0,
          "parked": 0.3
        },
        "queens_waterfront": {
          "lot": [
            24,
            48
          ],
          "endLot": [
            26,
            40
          ],
          "alley": 0.2,
          "open": 0.08,
          "mix": {
            "tower": 0.5,
            "midrise": 0.25,
            "warehouse": 0.15,
            "parking": 0.1
          },
          "tower": {
            "floors": [
              24,
              50
            ],
            "mats": [
              "glass_tower",
              "glass_tower",
              "office_stone"
            ]
          },
          "midrise": {
            "floors": [
              6,
              14
            ],
            "mats": [
              "glass_tower",
              "brick_red",
              "concrete"
            ]
          },
          "warehouse": {
            "floors": [
              1,
              2
            ],
            "floorH": 6,
            "mats": [
              "brick_red",
              "concrete"
            ]
          },
          "enterable": 0.4,
          "lobby": 0.3,
          "tank": 0.1,
          "shed": 0.04,
          "trees": 0.5,
          "newsstand": 0,
          "parked": 0.4
        },
        "queens_lowrise": {
          "lot": [
            12,
            36
          ],
          "endLot": [
            20,
            34
          ],
          "alley": 0.4,
          "open": 0.08,
          "mix": {
            "warehouse": 0.38,
            "walkup": 0.36,
            "lowrise": 0.1,
            "parking": 0.11,
            "canopy": 0.05
          },
          "warehouse": {
            "floors": [
              1,
              2
            ],
            "floorH": 6,
            "mats": [
              "brick_red",
              "concrete"
            ]
          },
          "walkup": {
            "floors": [
              2,
              5
            ],
            "mats": [
              "brick_red",
              "brick_brown"
            ]
          },
          "lowrise": {
            "floors": [
              1,
              3
            ],
            "mats": [
              "brick_red",
              "concrete"
            ]
          },
          "enterable": 0.38,
          "lobby": 0,
          "tank": 0.2,
          "shed": 0.02,
          "trees": 0.45,
          "newsstand": 0,
          "parked": 0.6
        }
      },
      "parks": [
        {
          "id": "central",
          "kind": "central",
          "label": "セントラルパーク",
          "rect": [
            -956,
            -3000,
            -233,
            -1369
          ],
          "drive": {
            "w": 10,
            "x": [
              -905,
              -290
            ],
            "z": [
              -1440,
              -2960
            ]
          },
          "paths": [
            [
              -905,
              -1700,
              -290,
              -1694
            ],
            [
              -905,
              -2105,
              -290,
              -2099
            ],
            [
              -905,
              -2705,
              -290,
              -2699
            ],
            [
              -602,
              -2960,
              -596,
              -1440
            ],
            [
              -452,
              -2960,
              -446,
              -2620
            ],
            [
              -752,
              -2300,
              -746,
              -1440
            ]
          ],
          "meadows": [
            [
              -800,
              -1760,
              -620,
              -1540
            ],
            [
              -720,
              -2880,
              -470,
              -2720
            ],
            [
              -430,
              -1980,
              -320,
              -1830
            ]
          ],
          "woods": [
            [
              -720,
              -2700,
              -500,
              -2560,
              2.2
            ],
            [
              -880,
              -2300,
              -760,
              -1900,
              1.6
            ],
            [
              -560,
              -1560,
              -330,
              -1400,
              1.3
            ]
          ],
          "rockChance": 0.18,
          "treeDensity": 2.2,
          "lampEvery": 26,
          "benchEvery": 34,
          "wall": 0.8
        },
        {
          "id": "bryant",
          "kind": "square",
          "label": "",
          "rect": [
            -455,
            15,
            -330,
            151
          ],
          "lawn": [
            -440,
            45,
            -345,
            121
          ],
          "treeRows": 2
        },
        {
          "id": "madsq",
          "kind": "square",
          "label": "",
          "rect": [
            -207,
            1289,
            -121,
            1505
          ],
          "lawn": [
            -195,
            1320,
            -133,
            1475
          ],
          "treeRows": 1
        },
        {
          "id": "ri_tip",
          "kind": "square",
          "label": "",
          "rect": [
            826,
            -860,
            954,
            -706
          ],
          "lawn": [
            850,
            -830,
            930,
            -740
          ],
          "treeRows": 1
        },
        {
          "id": "lic",
          "kind": "waterfront",
          "label": "",
          "rect": [
            1050,
            -560,
            1081,
            80
          ],
          "lawn": [
            1056,
            -520,
            1078,
            40
          ],
          "treeRows": 0
        }
      ],
      "lakes": [
        {
          "id": "lake",
          "y": -0.8,
          "bed": -3,
          "poly": [
            [
              -760,
              -2420
            ],
            [
              -700,
              -2470
            ],
            [
              -640,
              -2455
            ],
            [
              -600,
              -2500
            ],
            [
              -520,
              -2510
            ],
            [
              -470,
              -2470
            ],
            [
              -500,
              -2400
            ],
            [
              -560,
              -2380
            ],
            [
              -620,
              -2400
            ],
            [
              -690,
              -2370
            ],
            [
              -750,
              -2370
            ]
          ]
        },
        {
          "id": "reservoir",
          "y": -0.8,
          "bed": -4,
          "poly": [
            [
              -860,
              -3000
            ],
            [
              -860,
              -2930
            ],
            [
              -760,
              -2905
            ],
            [
              -560,
              -2900
            ],
            [
              -400,
              -2915
            ],
            [
              -330,
              -2950
            ],
            [
              -330,
              -3000
            ]
          ]
        }
      ],
      "landmarks": [
        {
          "id": "gct",
          "kind": "gct",
          "claim": [
            -99,
            -231,
            119,
            -15
          ],
          "params": {
            "rect": [
              -80,
              -165,
              70,
              -20
            ],
            "by": 0.15,
            "facade": [
              -5,
              -23.4
            ],
            "wallBackZ": -26.4,
            "concourse": [
              -50,
              -123,
              40,
              -52
            ],
            "vestibuleRoof": 20.75,
            "roofY": 38.15,
            "wing": [
              30,
              4.5,
              6
            ],
            "balcony": {
              "y": 9.15,
              "depth": 12,
              "z": [
                -115,
                -60
              ]
            },
            "platformRoof": 8.75,
            "eastBlock": [
              88,
              -226,
              114,
              -20,
              6
            ]
          }
        },
        {
          "id": "viaduct",
          "kind": "viaduct",
          "claim": null,
          "params": {
            "y": 7,
            "t": 0.8,
            "w": 14,
            "south": [
              20,
              150
            ],
            "north": [
              -310,
              -252
            ],
            "loop": [
              -93,
              -185,
              83,
              -13
            ],
            "lane": 12,
            "front": [
              -22.8,
              -13
            ]
          }
        },
        {
          "id": "tower",
          "kind": "slab_tower",
          "claim": [
            -45,
            -231,
            45,
            -186
          ],
          "params": {
            "x": 0,
            "z": -208,
            "w": 80,
            "d": 36,
            "chamfer": 6,
            "podium": 6.2,
            "portal": [
              -8,
              8,
              14
            ],
            "shaftTop": 218,
            "deck": 7,
            "pad": 12.5,
            "padHalf": 13
          }
        },
        {
          "id": "deco",
          "kind": "deco_tower",
          "claim": [
            146,
            -66,
            200,
            -20
          ],
          "params": {
            "x": 172.5,
            "z": -42,
            "base": [
              148,
              -66,
              197,
              -20,
              62
            ],
            "shaftTop": 200,
            "tiers": [
              20.5,
              18,
              7,
              18.6,
              16.3,
              10.8,
              16.4,
              14.4,
              15.35,
              13.9,
              12.2,
              19.9,
              11.1,
              9.7,
              24.45,
              8.1,
              7.1,
              29,
              5,
              4.4,
              33.55
            ],
            "topBox": 50.5,
            "lobby": 8
          }
        },
        {
          "id": "empire",
          "kind": "empire_tower",
          "claim": [
            -330,
            660,
            -238,
            706
          ],
          "params": {
            "x": -284,
            "z": 683,
            "yaw": 180,
            "tiers": [
              [
                -330,
                660,
                -238,
                706,
                0,
                25
              ],
              [
                -322,
                664,
                -246,
                702,
                25,
                90
              ],
              [
                -306,
                666,
                -262,
                700,
                90,
                260
              ]
            ],
            "spire": [
              [
                -306,
                666,
                -262,
                700,
                260,
                280
              ],
              [
                -301,
                670.5,
                -267,
                695.5,
                280,
                304
              ],
              [
                -297,
                673.5,
                -271,
                692.5,
                304,
                320
              ],
              [
                -293,
                676.5,
                -275,
                689.5,
                320,
                325
              ],
              [
                -290.5,
                678,
                -277.5,
                688,
                325,
                329
              ],
              [
                -289,
                679,
                -279,
                687,
                329,
                333
              ],
              [
                -287.6,
                679.4,
                -280.4,
                686.6,
                333,
                357.8
              ]
            ],
            "mast": [
              -284.3,
              682.7,
              -283.7,
              683.3,
              357.8,
              380.2
            ],
            "terraceY": 320,
            "terraceFence": 3.2,
            "lobby": 8
          }
        },
        {
          "id": "library",
          "kind": "library",
          "claim": [
            -330,
            20,
            -233,
            146
          ],
          "params": {
            "node": [
              -250.2,
              83
            ],
            "terrace": 2.4,
            "body": [
              -330,
              43,
              -252,
              123
            ],
            "floorH": 8.8,
            "floors": 2,
            "doors": [
              74,
              82,
              90
            ]
          }
        },
        {
          "id": "times",
          "kind": "times_square",
          "claim": null,
          "params": {
            "center": [
              -725,
              -200
            ],
            "billboardR": 230,
            "steps": [
              -756,
              -385,
              -746,
              -360
            ],
            "stepsTop": 5,
            "run": 12
          }
        },
        {
          "id": "rock",
          "kind": "rockefeller",
          "claim": [
            -440,
            -666,
            -330,
            -534
          ],
          "params": {
            "tower": [
              -430,
              -660,
              -394,
              -540,
              260
            ],
            "terraces": [
              240,
              250
            ],
            "pit": [
              -380,
              -625,
              -340,
              -575,
              -4
            ],
            "promenade": [
              -335,
              -608,
              -238,
              -592
            ]
          }
        },
        {
          "id": "un",
          "kind": "un",
          "claim": [
            605,
            -471,
            668,
            -15
          ],
          "params": {
            "slab": [
              628,
              -258,
              650,
              -168,
              154
            ],
            "assembly": [
              614,
              -428,
              660,
              -330,
              2,
              7
            ],
            "poles": [
              612,
              -455,
              -30,
              8
            ]
          }
        },
        {
          "id": "carrier",
          "kind": "carrier",
          "claim": null,
          "params": {
            "x": -2205,
            "z": -353,
            "yaw": -90,
            "deckTop": 17,
            "hullBottom": -4,
            "hullTop": 16,
            "hull": [
              [
                -124,
                -100,
                25
              ],
              [
                -100,
                70,
                30
              ],
              [
                70,
                100,
                26
              ],
              [
                100,
                118,
                18
              ],
              [
                118,
                129,
                8
              ]
            ],
            "deckOutline": [
              [
                -14.5,
                -134
              ],
              [
                -16.5,
                -130
              ],
              [
                -16.5,
                96
              ],
              [
                -14,
                112
              ],
              [
                -10.5,
                124
              ],
              [
                -6,
                131
              ],
              [
                -2,
                134
              ],
              [
                2,
                134
              ],
              [
                6,
                131
              ],
              [
                10.5,
                124
              ],
              [
                14,
                112
              ],
              [
                16.5,
                96
              ],
              [
                16.5,
                60
              ],
              [
                20,
                46
              ],
              [
                24.5,
                30
              ],
              [
                28.5,
                12
              ],
              [
                28.5,
                -36
              ],
              [
                25.5,
                -62
              ],
              [
                20,
                -86
              ],
              [
                16.5,
                -104
              ],
              [
                16.5,
                -130
              ],
              [
                14.5,
                -134
              ]
            ],
            "deckStrip": 0.25,
            "deck": [
              [
                -25.5,
                -62,
                -16.5,
                -46
              ]
            ],
            "island": [
              [
                -19.5,
                -16,
                -12.8,
                34,
                24.5
              ],
              [
                -19,
                -12,
                -13.3,
                30,
                27.5
              ],
              [
                -18.5,
                -6,
                -13.8,
                24,
                30.4
              ],
              [
                -18.3,
                -2,
                -14,
                20,
                33.4
              ],
              [
                -18,
                0,
                -14.3,
                16,
                35.2
              ],
              [
                -18,
                -14,
                -14.5,
                -2,
                40.2
              ]
            ],
            "mast": [
              -16.6,
              17,
              -15.8,
              17.8,
              35.2,
              58.9
            ],
            "stair": {
              "base": 2,
              "lanes": [
                18,
                21.5,
                25
              ],
              "z": [
                58,
                62.5
              ],
              "rise": 3,
              "flights": 5,
              "landNear": [
                56,
                58
              ],
              "landFar": [
                62.5,
                64.5
              ],
              "bridge": [
                16.2,
                18,
                62.5,
                64.5
              ]
            },
            "jbd": [
              [
                3.2,
                11.2,
                62.8,
                66,
                0.1
              ],
              [
                -11.2,
                -3.2,
                62.8,
                66,
                0.1
              ]
            ],
            "tubs": [
              [
                18.9,
                88
              ],
              [
                -18.9,
                88
              ],
              [
                18.9,
                -116
              ],
              [
                -18.9,
                -116
              ]
            ],
            "tubR": 2.35,
            "tubFloor": 16,
            "tubRim": 17.1,
            "jets": [],
            "tractors": [
              [
                -15,
                -99.5,
                0
              ],
              [
                -15,
                -106,
                180
              ]
            ],
            "tractorSize": [
              2.3,
              3.2,
              1.05
            ],
            "loot": [
              [
                18.9,
                16,
                88
              ],
              [
                -18.9,
                16,
                88
              ],
              [
                18.9,
                16,
                -116
              ],
              [
                -18.9,
                16,
                -116
              ],
              [
                0,
                17,
                20
              ],
              [
                -10,
                17,
                -36
              ],
              [
                23,
                17,
                63.5
              ],
              [
                14,
                17,
                110
              ]
            ],
            "shed": [
              -2290,
              -322,
              -2200,
              -306,
              2,
              4.5
            ],
            "flight": {
              "jetSpots": [
                [
                  -14.8,
                  -84,
                  40
                ],
                [
                  -14.8,
                  -60,
                  40
                ],
                [
                  -14.8,
                  -36,
                  40
                ],
                [
                  -14.8,
                  42,
                  0
                ]
              ],
              "cats": [
                [
                  -7.2,
                  73.5,
                  0,
                  55.63
                ],
                [
                  7.2,
                  73.5,
                  0,
                  55.63
                ]
              ],
              "lanes": [
                {
                  "cat": 2,
                  "pts": [
                    [
                      10,
                      -125
                    ],
                    [
                      10,
                      0
                    ],
                    [
                      7.2,
                      60
                    ],
                    [
                      7.2,
                      73.5
                    ]
                  ]
                },
                {
                  "cat": 1,
                  "pts": [
                    [
                      -14.8,
                      36
                    ],
                    [
                      -14.8,
                      54
                    ],
                    [
                      -7.2,
                      64
                    ],
                    [
                      -7.2,
                      73.5
                    ]
                  ]
                },
                {
                  "cat": 1,
                  "pts": [
                    [
                      10,
                      -125
                    ],
                    [
                      10,
                      22
                    ],
                    [
                      -2,
                      48
                    ],
                    [
                      -7.2,
                      60
                    ],
                    [
                      -7.2,
                      73.5
                    ]
                  ]
                }
              ],
              "landing": {
                "x": 3.458,
                "z": -89.124,
                "heading": 8,
                "length": 130.58,
                "wires": [
                  -12,
                  -4,
                  4,
                  12
                ],
                "wireHalfWidth": 11.5,
                "rampDist": 45.3,
                "halfWidthStbd": 12.6,
                "halfWidthPort": 11.3
              }
            }
          }
        },
        {
          "id": "bridge",
          "kind": "bridge",
          "claim": null,
          "params": {
            "z": -1400,
            "w": 29,
            "deckY": 40,
            "deckT": 1.5,
            "x0": 440,
            "xa": 760,
            "xb": 1060,
            "x1": 1380,
            "segment": 60,
            "deckHalf": 10.5,
            "barrier": [
              9.6,
              10.1,
              0.9
            ],
            "truss": [
              10.4,
              11.6,
              38.4,
              58
            ],
            "walkway": [
              11.7,
              14.5,
              39.85
            ],
            "rail": [
              14.5,
              14.7,
              41
            ],
            "towers": [
              790,
              910,
              1030
            ],
            "pier": [
              25,
              8,
              -3,
              38
            ],
            "legs": [
              11,
              0.8,
              6,
              0.7,
              80
            ],
            "portal": [
              10.4,
              6,
              0.5,
              59.6,
              77.6
            ],
            "towerTruss": [
              6.7,
              78
            ],
            "supportEvery": 40
          }
        },
        {
          "id": "hy",
          "kind": "hudson_yards",
          "claim": [
            -1767,
            655,
            -1523,
            951
          ],
          "params": {
            "deck": [
              -1762,
              660,
              -1528,
              946
            ],
            "y": 8,
            "t": 0.8,
            "towers": [
              [
                -1610,
                680,
                -1550,
                740,
                390
              ],
              [
                -1610,
                860,
                -1560,
                930,
                280
              ],
              [
                -1730,
                680,
                -1670,
                720,
                250
              ],
              [
                -1745,
                850,
                -1695,
                915,
                230
              ]
            ],
            "edge": [
              -1550,
              690,
              -1530,
              730,
              340
            ],
            "stairs": [
              -1545,
              788,
              -1531,
              800
            ],
            "ramp": [
              -1712,
              880,
              -1700,
              946
            ],
            "vessel": [
              -1650,
              790
            ],
            "columns": 16
          }
        },
        {
          "id": "yard_w",
          "kind": "railyard",
          "claim": [
            -1982,
            655,
            -1793,
            951
          ],
          "params": {
            "cars": 6,
            "tracks": 7
          }
        },
        {
          "id": "yard_q",
          "kind": "railyard",
          "claim": [
            2131,
            -785,
            2829,
            -15
          ],
          "params": {
            "cars": 18,
            "tracks": 14
          }
        },
        {
          "id": "gantry",
          "kind": "gantry",
          "claim": null,
          "params": {
            "items": [
              [
                1060,
                -300
              ],
              [
                1060,
                -200
              ]
            ],
            "h": 22,
            "span": 18
          }
        },
        {
          "id": "flatiron",
          "kind": "flatiron",
          "claim": [
            -202,
            1540,
            -150,
            1586
          ],
          "params": {
            "z0": 1540,
            "z1": 1586,
            "x0": -202,
            "slice": 4,
            "floors": 22,
            "floorH": 4
          }
        },
        {
          "id": "boathouse",
          "kind": "boathouse",
          "claim": [
            -512,
            -2550,
            -470,
            -2484
          ],
          "params": {
            "rect": [
              -506,
              -2546,
              -474,
              -2522
            ],
            "floors": 2,
            "floorH": 4,
            "dock": [
              -512,
              -2522,
              -488,
              -2484
            ]
          }
        },
        {
          "id": "boats",
          "kind": "boats",
          "claim": null,
          "params": {
            "ferry": [
              -2190,
              120,
              90,
              30,
              10.4,
              2.2
            ],
            "tug": [
              890,
              300,
              0,
              28,
              10.2,
              2.3
            ]
          }
        }
      ],
      "heliports": [
        {
          "id": "h_gct",
          "label": "グランドセントラル",
          "x": -5,
          "y": 38.15,
          "z": -88,
          "r": 9,
          "access": "climb"
        },
        {
          "id": "h_tower",
          "label": "",
          "x": 0,
          "y": 230.5,
          "z": -208,
          "r": 9,
          "access": "heli"
        },
        {
          "id": "h_cpark",
          "label": "セントラルパーク",
          "x": -710,
          "y": 0,
          "z": -1650,
          "r": 12,
          "access": "walk"
        },
        {
          "id": "h_hudson",
          "label": "",
          "x": -2125,
          "y": 0,
          "z": 960,
          "r": 10,
          "access": "walk"
        },
        {
          "id": "h_east",
          "label": "",
          "x": 765,
          "y": 0,
          "z": 640,
          "r": 10,
          "access": "walk"
        },
        {
          "id": "h_carrier",
          "label": "空母",
          "x": -2093,
          "y": 15,
          "z": -351,
          "r": 6,
          "access": "walk",
          "spawn": [
            -2150,
            -316,
            90,
            0
          ]
        },
        {
          "id": "h_bryant",
          "label": "",
          "x": -392,
          "y": 0,
          "z": 83,
          "r": 10,
          "access": "walk"
        },
        {
          "id": "h_un",
          "label": "国連広場",
          "x": 636,
          "y": 0.15,
          "z": -70,
          "r": 9,
          "access": "walk"
        },
        {
          "id": "h_roosevelt",
          "label": "ルーズベルト島",
          "x": 890,
          "y": 0,
          "z": -785,
          "r": 10,
          "access": "walk"
        },
        {
          "id": "h_lic",
          "label": "",
          "x": 1066,
          "y": 0,
          "z": -110,
          "r": 9,
          "access": "walk"
        },
        {
          "id": "h_hy",
          "label": "ハドソンヤード",
          "x": -1650,
          "y": 8,
          "z": 905,
          "r": 10,
          "access": "walk"
        }
      ],
      "hotZones": [
        {
          "id": "gct",
          "label": "グランドセントラル",
          "x": -5,
          "z": -95,
          "r": 160,
          "loot": "hot"
        },
        {
          "id": "times",
          "label": "タイムズスクエア",
          "x": -725,
          "z": -200,
          "r": 200,
          "loot": "hot"
        },
        {
          "id": "library",
          "label": "図書館",
          "x": -330,
          "z": 83,
          "r": 140,
          "loot": "hot"
        },
        {
          "id": "carrier",
          "label": "空母",
          "x": -2200,
          "z": -360,
          "r": 170,
          "loot": "hot"
        },
        {
          "id": "hy",
          "label": "ハドソンヤード",
          "x": -1640,
          "z": 800,
          "r": 200,
          "loot": "hot"
        },
        {
          "id": "rock",
          "label": "プラザ",
          "x": -360,
          "z": -600,
          "r": 160,
          "loot": "hot"
        },
        {
          "id": "un",
          "label": "国連広場",
          "x": 635,
          "z": -240,
          "r": 200,
          "loot": "hot"
        },
        {
          "id": "roosevelt",
          "label": "ルーズベルト島",
          "x": 890,
          "z": -1000,
          "r": 260,
          "loot": "hot"
        },
        {
          "id": "lic",
          "label": "クイーンズ",
          "x": 1200,
          "z": -250,
          "r": 260,
          "loot": "hot"
        },
        {
          "id": "boathouse",
          "label": "セントラルパーク",
          "x": -500,
          "z": -2520,
          "r": 200,
          "loot": "hot"
        }
      ],
      "labels": [
        {
          "text": "橋",
          "x": 905,
          "z": -1400
        },
        {
          "text": "セントラルパーク",
          "x": -600,
          "z": -2000
        },
        {
          "text": "クイーンズ",
          "x": 2000,
          "z": 300
        }
      ],
      "subway": {
        "avenues": [
          "8",
          "7",
          "6",
          "5",
          "park",
          "lex",
          "2"
        ],
        "streets": [
          14,
          23,
          28,
          34,
          42,
          47,
          50,
          53,
          57,
          59,
          68,
          72,
          77
        ]
      },
      "vehicles": {
        "hotRange": 500,
        "nearHot": 0.5,
        "elsewhere": 0.08,
        "mix": [
          [
            "jeep",
            5
          ],
          [
            "pickup",
            4
          ],
          [
            "apc",
            1
          ]
        ],
        "heli": true,
        "jets": true
      },
      "spawns": {
        "perZone": 8,
        "minR": 12,
        "maxR": 0.6,
        "clear": 0.6
      },
      "loot": {
        "tables": {
          "street": [
            [
              "pistol",
              3
            ],
            [
              "ammo_9mm",
              4
            ],
            [
              "bandage",
              4
            ],
            [
              "ammo_556",
              2
            ],
            [
              "shotgun",
              1
            ]
          ],
          "interior": [
            [
              "rifle",
              3
            ],
            [
              "p90",
              3
            ],
            [
              "shotgun",
              3
            ],
            [
              "pistol",
              2
            ],
            [
              "ammo_556",
              4
            ],
            [
              "ammo_57",
              3
            ],
            [
              "ammo_12g",
              3
            ],
            [
              "medkit",
              2
            ],
            [
              "bandage",
              3
            ],
            [
              "armor_vest",
              1
            ],
            [
              "helmet",
              1
            ]
          ],
          "roof": [
            [
              "sniper",
              3
            ],
            [
              "rifle",
              2
            ],
            [
              "ammo_338",
              3
            ],
            [
              "ammo_556",
              2
            ],
            [
              "medkit",
              1
            ]
          ],
          "hot": [
            [
              "rifle",
              4
            ],
            [
              "p90",
              3
            ],
            [
              "lmg",
              1
            ],
            [
              "sniper",
              1
            ],
            [
              "shotgun",
              2
            ],
            [
              "ammo_556",
              4
            ],
            [
              "ammo_57",
              3
            ],
            [
              "ammo_338",
              1
            ],
            [
              "medkit",
              3
            ],
            [
              "armor_vest",
              2
            ],
            [
              "helmet",
              2
            ]
          ],
          "gct_balcony": [
            [
              "lmg",
              4
            ],
            [
              "rifle",
              2
            ],
            [
              "ammo_556",
              4
            ],
            [
              "medkit",
              2
            ],
            [
              "armor_vest",
              1
            ]
          ],
          "park": [
            [
              "shotgun",
              2
            ],
            [
              "pistol",
              2
            ],
            [
              "ammo_12g",
              3
            ],
            [
              "bandage",
              3
            ]
          ]
        },
        "perFloor": [
          1,
          2
        ],
        "hotPerFloor": [
          2,
          3
        ],
        "roofChance": 0.45,
        "streetPerBlock": 0.3,
        "hotStreet": 2,
        "lobby": 1,
        "parkPerCell": 0.04
      },
      "rings": {
        "center": [
          -300,
          -300
        ],
        "randomCenter": 0.35,
        "startR": 4300,
        "phases": [
          {
            "wait": 90,
            "shrink": 60,
            "r": 2600,
            "dps": 1
          },
          {
            "wait": 75,
            "shrink": 50,
            "r": 1500,
            "dps": 2
          },
          {
            "wait": 60,
            "shrink": 45,
            "r": 800,
            "dps": 4
          },
          {
            "wait": 45,
            "shrink": 40,
            "r": 400,
            "dps": 7
          },
          {
            "wait": 30,
            "shrink": 30,
            "r": 150,
            "dps": 10
          },
          {
            "wait": 20,
            "shrink": 25,
            "r": 0,
            "dps": 15
          }
        ]
      }
    }
  }
};
