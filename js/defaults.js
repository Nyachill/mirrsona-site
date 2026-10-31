// このファイルは tools/build-manifest.js が自動生成する。手で編集しない。
// サーバーにも端末にもデータが無いとき（初回オフライン起動など）に使う内蔵データ。
window.MR = window.MR || {};
MR.DEFAULT_DATA = {
  "version": "0.1.0-f34856-embedded",
  "files": {
    "config/game.json": {
      "level": "arena01",
      "city": {
        "soloLevel": "midtown",
        "manhattanPicker": true,
        "loadTimeout": 60,
        "enemies": true,
        "vehicles": true,
        "ambience": "ambience_city",
        "enemyCount": 7,
        "spawnMin": 40,
        "spawnMax": 120,
        "buildingSpawnMax": 170,
        "deferForView": 4,
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
        "perchDy": 60,
        "perchMin": 20,
        "pathBudgetMs": 2.5,
        "graphBudgetMs": 2.5,
        "pathMaxExpand": 6000,
        "pathMaxExpandUnder": 6000,
        "maxVehicles": 24,
        "airSpawnAgl": 40,
        "airSpawnSpeed": 15,
        "jets": false,
        "vtol": true,
        "interiors": true,
        "doors": {
          "enabled": true,
          "openRadius": 4,
          "openHeight": 2.6,
          "lead": 0.4,
          "closeDelay": 3,
          "slideTime": 0.6,
          "swingTime": 0.8,
          "swingAngle": 92,
          "minWidth": 1.2,
          "maxWidth": 6,
          "minHeight": 2,
          "maxHeight": 6.5,
          "volume": 0.5,
          "soundDist": 30
        },
        "airDefense": {
          "enabled": true,
          "sites": 3,
          "targets": [
            "jet",
            "vtol"
          ],
          "siteRadius": 260,
          "roofMin": 18,
          "roofMax": 170,
          "minArea": 90,
          "range": 1600,
          "minAgl": 25,
          "maxAlt": 900,
          "lockTime": 1.6,
          "reaction": [
            1,
            2.5
          ],
          "cooldown": [
            30,
            45
          ],
          "maxActive": 1,
          "chance": 0.6,
          "graceAfterLaunch": 12,
          "carrierSafe": 900,
          "revealSec": 20,
          "killRadius": 14,
          "gunHits": 12,
          "respawn": 120,
          "soldierDist": 350,
          "checkHz": 4,
          "type": "manpads",
          "gunRadius": 5,
          "minSpacing": 60,
          "launchHeight": 2.2,
          "launchSpeed": 30,
          "launchLoft": 0.15,
          "losMisses": 2,
          "searchToneLead": 0.5
        },
        "boats": true,
        "ships": true,
        "enemy": {
          "stationDy": 14,
          "losHeadDrop": 0.05,
          "detectRange": 110,
          "attackRange": 45,
          "roofAttackRange": 75,
          "hitChance": 0.38,
          "speed": 3.8,
          "ladderSpeed": 2.4,
          "repathCity": 2.5,
          "overwatchPatience": 12,
          "heliAttackRange": 90,
          "jetAttackRange": 70,
          "boatAttackRange": 80,
          "boatSpawnSpeed": 8
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
        "pickShift": 1.6,
        "pickReal": 2,
        "pickupHeight": 1.2,
        "autoRadius": 1.1,
        "drawDist": 40,
        "drawDistMobile": 32,
        "weaponTextureMaxMobile": 512,
        "viewMaxSpeed": 60,
        "viewMaxAgl": 60,
        "viewResume": 0.8,
        "viewTeleport": 50,
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
        "jets": false,
        "vtol": true,
        "airDefense": {
          "enabled": true,
          "sites": 3,
          "targets": [
            "jet",
            "vtol"
          ],
          "siteRadius": 260,
          "roofMin": 18,
          "roofMax": 170,
          "minArea": 90,
          "range": 1600,
          "minAgl": 25,
          "maxAlt": 900,
          "lockTime": 1.6,
          "reaction": [
            1,
            2.5
          ],
          "cooldown": [
            30,
            45
          ],
          "maxActive": 1,
          "chance": 0.6,
          "graceAfterLaunch": 12,
          "carrierSafe": 900,
          "revealSec": 20,
          "killRadius": 14,
          "gunHits": 12,
          "respawn": 120,
          "soldierDist": 350,
          "checkHz": 4,
          "type": "manpads",
          "gunRadius": 5,
          "minSpacing": 60,
          "launchHeight": 2.2,
          "launchSpeed": 30,
          "launchLoft": 0.15,
          "losMisses": 2,
          "searchToneLead": 0.5
        },
        "boats": true,
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
        "overviewResMobile": 12,
        "overviewMobileMaxPx": 1100,
        "overviewFrom": 420,
        "maxTiles": 24,
        "hz": 30,
        "labels": true,
        "vehicleRange": 400,
        "liftIcon": true
      },
      "story": {
        "enabled": true,
        "difficulty": "normal",
        "diffs": {
          "easy": {
            "hp": 0.7,
            "acc": 0.6,
            "dmg": 0.6
          },
          "normal": {
            "hp": 1,
            "acc": 1,
            "dmg": 1
          },
          "hard": {
            "hp": 1.3,
            "acc": 1.25,
            "dmg": 1.35
          }
        },
        "radio": {
          "minSec": 1.2,
          "perChar": 0.11,
          "maxQueue": 8,
          "gap": 0.25
        },
        "talk": {
          "autoSec": 2.4,
          "perChar": 0.06,
          "skipHold": 0.6,
          "history": 60
        },
        "markers": {
          "max": 3,
          "edge": 28
        },
        "card": {
          "sec": 3.2
        },
        "ally": {
          "speed": 4.6,
          "dps": 18,
          "killShare": 0.4,
          "fireMin": 0.6,
          "fireMax": 1.2,
          "range": 40,
          "followMin": 3,
          "followMax": 6,
          "leadWait": 15,
          "stuckDist": 25,
          "stuckSec": 3,
          "pathMaxExpand": 80000
        },
        "civ": {
          "speed": 4,
          "clearRadius": 25,
          "pathMaxExpand": 80000
        },
        "caps": {
          "enemies": 7,
          "others": 3,
          "shadowDist": 30
        },
        "cine": {
          "maxDistNoFade": 250,
          "skipHold": 0.6
        },
        "relight": {
          "dim": 0.35,
          "ringSec": 4,
          "pillarH": 400,
          "pillarR": 4,
          "pillarColor": "#ffd9a0",
          "pillarSec": 12,
          "nearSec": 1.5
        },
        "vtol": {
          "speed": 24,
          "climb": 7,
          "rampSec": 2.5,
          "turnRate": 60,
          "footZ": 10.09,
          "routeClear": 25,
          "routeSide": 24,
          "routeEnd": 30,
          "legReach": 6,
          "descendAbove": 15
        },
        "strike": {
          "length": 30,
          "noFire": 12,
          "delay": 3,
          "cooldown": 45,
          "shots": 6,
          "blast": "story_strike",
          "pass": 2.2,
          "height": 60,
          "maxClimb": 40
        },
        "interact": {
          "radius": 2.2,
          "dy": 1.8,
          "holdCancelDist": 4,
          "hitCancel": 20,
          "hitSetback": 0.6
        },
        "board": {
          "radius": 5,
          "fadeSec": 0.45
        },
        "billboard": {
          "size": [
            1024,
            1024
          ],
          "intensity": 1.4,
          "texts": {
            "rescue": {
              "bg": "#0a2a3a",
              "color": "#e8f8ff",
              "lines": [
                "MIRRSONA 救助のお知らせ",
                "ブライアントパークで七号機が待機中",
                "けが人・子どもを優先します"
              ]
            },
            "kagami": {
              "bg": "#060203",
              "color": "#ff5a4a",
              "lines": [
                "おかえり、R-07",
                "ペルソナ計画　ヴェール"
              ]
            }
          }
        },
        "alert": {
          "radius": 30
        },
        "unstuck": {
          "sec": 6,
          "dy": 4,
          "skipRoles": [
            "climber",
            "overwatch"
          ],
          "seeDist": 150,
          "homeWaitK": 3,
          "popMin": 25,
          "altRings": [
            6,
            12,
            20
          ],
          "altAngles": 8
        },
        "cpMinHp": 70,
        "failDelay": 1.6,
        "resultDelay": 2.4,
        "save": {
          "maxBytes": 16384
        }
      },
      "lift": {
        "radius": 3,
        "frontMin": -0.7,
        "halfW": 1.4,
        "legacyRadius": 1.6,
        "maxDy": 1.5,
        "time": 2.5,
        "commit": 0.8,
        "fadeOut": 0.45,
        "fadeIn": 0.5,
        "cooldown": 0.6,
        "shake": 0.12,
        "placeAbove": 0.6,
        "arriveOffset": 0.03,
        "netWait": 3,
        "labels": {
          "L0": "ロビー",
          "L1": "デッキ 128 m",
          "L2": "スカイフロア 256 m"
        },
        "view": {
          "enabled": true,
          "createDist": 350,
          "disposeDist": 600,
          "viewDist": 220,
          "doorBack": 0.8,
          "doorW": 2.4,
          "doorH": 3.3,
          "frame": 0.16,
          "signH": 0.75,
          "signGap": 0.12,
          "glow": 1,
          "panelGain": 1.3,
          "panelSize": 1.4,
          "panelEvery": 6,
          "poolGain": 0.06,
          "poolRadius": 3.2,
          "ceilingDrop": 0.06,
          "cladding": true,
          "canopy": {
            "halfW": 3.5,
            "depth": 3.5,
            "y0": 5,
            "y1": 5.5,
            "inset": 0.02,
            "signH": 0.75,
            "signThick": 0.15,
            "soffit": 0.17,
            "rim": 0.08,
            "downlight": 0.42
          },
          "metalness": 0.55,
          "roughness": 0.38,
          "emissive": 0.35,
          "texts": {
            "title": "MIRRSONA SKY HIGH",
            "lift": "エレベーター",
            "here": "この奥",
            "other": "エレベーターは西のロビー"
          }
        },
        "guide": {
          "dist": 15,
          "markerFrom": 1.3,
          "markerStep": 1,
          "markers": 3,
          "pulse": 5
        }
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
        "indoorPenalty": 50,
        "streetMaxH": 0.6,
        "roofMinH": 2.5,
        "maxPush": 0.3,
        "maxDrop": 3,
        "exactTol": 0.5,
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
          "enemyClear": 18,
          "losRange": 60,
          "losMargin": 0.5,
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
        "furnMantleDepth": 1.5,
        "crouch": true,
        "crouchEye": 1,
        "crouchChest": 0.8,
        "crouchSpeed": 0.5,
        "crouchTime": 0.15,
        "fallDamage": {
          "minHeight": 6,
          "perMeter": 5,
          "curve": 0.4
        }
      },
      "controls": {
        "fireDragLook": true,
        "leftFireButton": true,
        "jet": "auto",
        "vtol": "auto"
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
              0.1,
              -0.095,
              -0.27
            ],
            "viewRot": [
              0,
              0.02,
              0
            ],
            "adsPos": [
              0,
              -0.085,
              -0.22
            ],
            "viewScale": 0.6,
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.008,
                0.03
              ],
              "gripR": 0.018,
              "gripTilt": 8,
              "left": "guard",
              "fore": [
                0,
                0,
                -0.13
              ],
              "foreR": 0.022
            },
            "view0": {
              "viewScale": 0.68,
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
              ]
            },
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
            "viewScale": 0.46,
            "viewPos": [
              0.09,
              -0.09,
              -0.27
            ],
            "viewRot": [
              0,
              0.02,
              0
            ],
            "adsPos": [
              0,
              -0.08,
              -0.14
            ],
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.042,
                0.024
              ],
              "gripR": 0.017,
              "gripTilt": 20,
              "left": "guard",
              "fore": [
                0,
                0.09,
                -0.317
              ],
              "foreR": 0.028
            },
            "view0": {
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
              ]
            },
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
              0.095,
              -0.095,
              -0.29
            ],
            "viewRot": [
              0,
              0.02,
              0
            ],
            "adsPos": [
              0,
              -0.09,
              -0.36
            ],
            "viewScale": 0.52,
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.014,
                0.05
              ],
              "gripR": 0.019,
              "gripTilt": 62,
              "elbowR": [
                0.06,
                -0.6,
                0.22
              ],
              "elbowL": [
                -0.12,
                -0.6,
                0.24
              ],
              "left": "guard",
              "fore": [
                0,
                0.004,
                -0.35
              ],
              "foreR": 0.022
            },
            "view0": {
              "viewScale": 0.6,
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
              ]
            },
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
            "viewScale": 0.42,
            "viewPos": [
              0.1,
              -0.1,
              -0.29
            ],
            "viewRot": [
              0,
              0.02,
              0
            ],
            "adsPos": [
              0,
              -0.064,
              -0.16
            ],
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.036,
                0.018
              ],
              "gripR": 0.017,
              "left": "guard",
              "fore": [
                0,
                0.042,
                -0.4
              ],
              "foreR": 0.024
            },
            "view0": {
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
              ]
            },
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
            "viewScale": 0.38,
            "viewPos": [
              0.1,
              -0.095,
              -0.29
            ],
            "viewRot": [
              0,
              0.02,
              0
            ],
            "adsPos": [
              0,
              -0.055,
              -0.006
            ],
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.032,
                0.012
              ],
              "gripR": 0.017,
              "gripTilt": 14,
              "left": "guard",
              "fore": [
                0,
                0.058,
                -0.36
              ],
              "foreR": 0.022
            },
            "view0": {
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
              ]
            },
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
            "viewScale": 0.68,
            "viewPos": [
              0.075,
              -0.08,
              -0.3
            ],
            "viewRot": [
              0.02,
              0.04,
              0
            ],
            "adsPos": [
              0,
              -0.06,
              -0.16
            ],
            "adsAlign": true,
            "hands": {
              "grip": [
                0,
                -0.042,
                0.03
              ],
              "gripR": 0.017,
              "gripTilt": 18,
              "left": "pistol"
            },
            "view0": {
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
              ]
            },
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
      "melee": {
        "enabled": true,
        "online": false,
        "name": "ナイフ",
        "quick": {
          "time": 0.55,
          "cooldown": 0.15,
          "hitFrom": 0.12,
          "hitTo": 0.26,
          "damage": 55,
          "reach": 1.7,
          "bladeRadius": 0.1
        },
        "slash": {
          "time": 0.42,
          "cooldown": 0.05,
          "hitFrom": 0.07,
          "hitTo": 0.2,
          "damage": 50,
          "reach": 1.7,
          "bladeRadius": 0.1
        },
        "stab": {
          "time": 0.5,
          "cooldown": 0.1,
          "hitFrom": 0.17,
          "hitTo": 0.3,
          "damage": 70,
          "reach": 1.95,
          "bladeRadius": 0.07
        },
        "draw": {
          "time": 0.3
        },
        "inspect": {
          "time": 1.6
        },
        "holster": {
          "time": 0.25
        },
        "drawHold": 0.35,
        "comboWindow": 0.5,
        "inspectHold": 0.35,
        "assist": {
          "range": 2.8,
          "angle": 35,
          "maxTurn": 12,
          "maxLunge": 1.1,
          "lungeTime": 0.14,
          "stopAt": 1.05,
          "maxDy": 1.4
        },
        "backstab": {
          "angle": 60,
          "damage": 400
        },
        "enemy": {
          "share": 0.5,
          "chargeRange": 9,
          "range": 1.6,
          "reach": 2,
          "maxDy": 1.2,
          "speed": 5.2,
          "time": 0.7,
          "hitAt": 0.36,
          "damage": 22,
          "cooldown": 0.9,
          "angle": 55,
          "stagger": 0.45,
          "knockback": 0.6,
          "knockTime": 0.15,
          "losEvery": 0.2,
          "volSwing": 0.8,
          "pose": [
            [
              0,
              0,
              10,
              0,
              0,
              -5
            ],
            [
              -55,
              0,
              25,
              25,
              0,
              -10
            ],
            [
              -70,
              0,
              0,
              30,
              0,
              0
            ],
            [
              0,
              20,
              0,
              0,
              -25,
              0
            ]
          ],
          "poseCode": [
            -0.9,
            0.35,
            -0.9,
            0.55,
            0.25,
            -0.3
          ],
          "curve": [
            0.4,
            0.12,
            0.55,
            0.6
          ],
          "volHit": 0.9,
          "progressMin": 0.3,
          "stuckTime": 0.3,
          "giveUp": 2,
          "dropMax": 0.6
        },
        "headMult": 1.2,
        "guardMs": 150,
        "hotEvery": 0.1,
        "feel": {
          "kickHit": 1.2,
          "kickWall": 0.6,
          "shakeHit": 0.25,
          "shakeMax": 1.5,
          "volSwing": 0.9,
          "volHit": 1,
          "volWall": 0.8,
          "volDraw": 0.7,
          "aimY": 1.2,
          "aimHeadY": 1.25,
          "pitchMax": 85,
          "bob": 0.008
        },
        "sounds": {
          "swing": "knife_swing",
          "stab": "knife_stab",
          "hit": "knife_hit",
          "wall": "knife_wall",
          "draw": "knife_draw"
        },
        "model": {
          "file": "models/knife.glb",
          "scale": 1
        },
        "trail": {
          "samples": 12,
          "pad": 0.04,
          "fade": 0.12,
          "color": "#d6e8ff",
          "opacity": 0.55
        },
        "view": {
          "pos": [
            0.2,
            -0.24,
            -0.34
          ],
          "scale": 1,
          "elbow": [
            0.3,
            -0.5,
            0.05
          ],
          "armLen": 0.36,
          "drawnPeriod": 2.4,
          "rigDrop": 0.35
        },
        "anim": {
          "quick": [
            {
              "t": 0,
              "p": [
                0.38,
                -0.5,
                -0.32
              ],
              "r": [
                20,
                40,
                -40
              ]
            },
            {
              "t": 0.14,
              "p": [
                0.32,
                -0.08,
                -0.46
              ],
              "r": [
                25,
                70,
                -60
              ]
            },
            {
              "t": 0.27,
              "p": [
                0.05,
                -0.08,
                -0.55
              ],
              "r": [
                20,
                80,
                -75
              ]
            },
            {
              "t": 0.4,
              "p": [
                -0.24,
                -0.16,
                -0.48
              ],
              "r": [
                10,
                85,
                -85
              ]
            },
            {
              "t": 0.65,
              "p": [
                -0.22,
                -0.4,
                -0.34
              ],
              "r": [
                -10,
                60,
                -60
              ]
            },
            {
              "t": 1,
              "p": [
                0.12,
                -0.62,
                -0.28
              ],
              "r": [
                -30,
                20,
                -30
              ]
            }
          ],
          "drawn": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 0.5,
              "p": [
                0.2,
                -0.206,
                -0.358
              ],
              "r": [
                14,
                24,
                -36
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "draw": [
            {
              "t": 0,
              "p": [
                0.12,
                -0.62,
                -0.28
              ],
              "r": [
                -30,
                20,
                -30
              ]
            },
            {
              "t": 0.6,
              "p": [
                0.22,
                -0.17,
                -0.37
              ],
              "r": [
                22,
                28,
                -30
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "slash": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 0.15,
              "p": [
                0.34,
                -0.06,
                -0.44
              ],
              "r": [
                25,
                70,
                -60
              ]
            },
            {
              "t": 0.32,
              "p": [
                0.04,
                -0.08,
                -0.55
              ],
              "r": [
                20,
                80,
                -75
              ]
            },
            {
              "t": 0.5,
              "p": [
                -0.24,
                -0.16,
                -0.48
              ],
              "r": [
                10,
                85,
                -85
              ]
            },
            {
              "t": 0.75,
              "p": [
                -0.05,
                -0.3,
                -0.4
              ],
              "r": [
                5,
                50,
                -60
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "slash2": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 0.18,
              "p": [
                -0.2,
                -0.06,
                -0.46
              ],
              "r": [
                25,
                40,
                -110
              ]
            },
            {
              "t": 0.36,
              "p": [
                0.05,
                -0.08,
                -0.55
              ],
              "r": [
                20,
                -10,
                -95
              ]
            },
            {
              "t": 0.55,
              "p": [
                0.3,
                -0.14,
                -0.46
              ],
              "r": [
                10,
                -50,
                -80
              ]
            },
            {
              "t": 0.8,
              "p": [
                0.25,
                -0.25,
                -0.4
              ],
              "r": [
                10,
                0,
                -50
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "stab": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 0.25,
              "p": [
                0.2,
                -0.2,
                -0.26
              ],
              "r": [
                15,
                30,
                -60
              ]
            },
            {
              "t": 0.45,
              "p": [
                0.06,
                -0.12,
                -0.62
              ],
              "r": [
                18,
                22,
                -55
              ]
            },
            {
              "t": 0.7,
              "p": [
                0.12,
                -0.16,
                -0.45
              ],
              "r": [
                15,
                25,
                -45
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "inspect": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 0.15,
              "p": [
                0.09,
                -0.1,
                -0.37
              ],
              "r": [
                10,
                80,
                0
              ]
            },
            {
              "t": 0.3,
              "p": [
                0.09,
                -0.1,
                -0.37
              ],
              "r": [
                10,
                80,
                90
              ]
            },
            {
              "t": 0.45,
              "p": [
                0.09,
                -0.1,
                -0.37
              ],
              "r": [
                10,
                80,
                180
              ]
            },
            {
              "t": 0.62,
              "p": [
                0.09,
                -0.1,
                -0.37
              ],
              "r": [
                10,
                80,
                180
              ]
            },
            {
              "t": 0.77,
              "p": [
                0.09,
                -0.1,
                -0.37
              ],
              "r": [
                10,
                80,
                270
              ]
            },
            {
              "t": 0.9,
              "p": [
                0.12,
                -0.16,
                -0.35
              ],
              "r": [
                12,
                50,
                0
              ]
            },
            {
              "t": 1,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            }
          ],
          "holster": [
            {
              "t": 0,
              "p": [
                0.2,
                -0.2,
                -0.36
              ],
              "r": [
                15,
                25,
                -35
              ]
            },
            {
              "t": 1,
              "p": [
                0.18,
                -0.62,
                -0.26
              ],
              "r": [
                -45,
                10,
                -30
              ]
            }
          ]
        }
      },
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
        "disposePerFrame": 1,
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
          },
          "textureMaxMobile": {
            "map": 1024,
            "detail": 512
          },
          "gunTextureMaxMobile": 512
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
          "interiors": {
            "detailDist": 6,
            "nDist": 0,
            "maxPanels": 0,
            "cards": false,
            "atlas": 512,
            "maxShell": 600,
            "dressDist": 0,
            "foliage": false
          },
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
      "waterFx": {
        "enabled": true,
        "maxDrops": 1024,
        "maxMist": 128,
        "maxPulses": 3,
        "coverageMax": 2.5,
        "nearFade": 4,
        "maxDist": 320,
        "rotorRadius": 5.35,
        "maxAgl": 30,
        "ringGrow": 1.2,
        "horseFrom": 12,
        "horseTo": 28,
        "rotorFrom": 0.4,
        "rotorFull": 0.95,
        "dropRate": 1100,
        "dropLife": [
          0.55,
          1.1
        ],
        "dropSpeed": [
          5,
          14
        ],
        "dropUp": [
          1.2,
          5.5
        ],
        "dropSize": [
          0.035,
          0.09
        ],
        "dropStretch": 0.035,
        "mistRate": 46,
        "mistLife": [
          1.8,
          3.2
        ],
        "mistSpeed": [
          3,
          7.5
        ],
        "mistUp": [
          0.3,
          1.1
        ],
        "mistSize0": [
          1,
          1.8
        ],
        "mistSize1": [
          4.5,
          8.5
        ],
        "mistDrag": 0.9,
        "mistBuoy": 0.25,
        "mistAlpha": 0.32,
        "mistMinAlpha": 0.02,
        "gravity": 9.8,
        "horseCut": 1.6,
        "ringBand": [
          0.82,
          1.14
        ],
        "mistBand": [
          0.75,
          1.15
        ],
        "inherit": [
          0.25,
          0.3
        ],
        "mistLift": [
          0.3,
          1.1
        ],
        "surface": true,
        "darkness": 0.5,
        "ripple": 0.38,
        "foam": 0.7,
        "sound": "water_lap",
        "soundVolume": 0.9,
        "soundRef": 9,
        "soundMax": 140,
        "bulletMaxPerSec": 20,
        "kinds": {
          "bullet": {
            "ref": 0.5,
            "drops": 8,
            "up": [
              2,
              4.5
            ],
            "out": [
              0.3,
              1.2
            ],
            "size": [
              0.02,
              0.05
            ],
            "life": [
              0.4,
              0.8
            ],
            "mist": 0,
            "pulse": 0,
            "lens": 0
          },
          "swim": {
            "ref": 0.35,
            "drops": 5,
            "up": [
              0.6,
              1.6
            ],
            "out": [
              0.3,
              1
            ],
            "size": [
              0.02,
              0.045
            ],
            "life": [
              0.3,
              0.6
            ],
            "mist": 0,
            "pulse": 0,
            "lens": 0
          },
          "bubble": {
            "ref": 0.8,
            "drops": 3,
            "up": [
              0.3,
              0.9
            ],
            "out": [
              0.1,
              0.4
            ],
            "size": [
              0.02,
              0.04
            ],
            "life": [
              0.25,
              0.5
            ],
            "mist": 0,
            "pulse": 0,
            "lens": 0
          },
          "wake": {
            "ref": 1.6,
            "drops": 14,
            "up": [
              1.5,
              3.5
            ],
            "out": [
              1,
              3
            ],
            "size": [
              0.03,
              0.07
            ],
            "life": [
              0.5,
              0.9
            ],
            "mist": 0,
            "pulse": 0,
            "lens": 0.15
          },
          "body": {
            "ref": 1,
            "drops": 28,
            "up": [
              2,
              5
            ],
            "out": [
              0.8,
              2.5
            ],
            "size": [
              0.03,
              0.07
            ],
            "life": [
              0.5,
              1
            ],
            "mist": 1,
            "pulse": 0.6,
            "mistUp": [
              0.5,
              1.5
            ],
            "mistSize": [
              0.4,
              1.6
            ],
            "lens": 0.25
          },
          "vehicle": {
            "ref": 2.5,
            "drops": 50,
            "up": [
              3,
              7
            ],
            "out": [
              1.5,
              4
            ],
            "size": [
              0.05,
              0.12
            ],
            "life": [
              0.7,
              1.3
            ],
            "mist": 3,
            "pulse": 1,
            "mistUp": [
              1,
              3
            ],
            "mistSize": [
              1,
              3.5
            ],
            "lens": 0.45
          },
          "missile": {
            "ref": 3,
            "drops": 110,
            "up": [
              8,
              16
            ],
            "out": [
              0.8,
              3.5
            ],
            "size": [
              0.09,
              0.2
            ],
            "life": [
              1.2,
              2.2
            ],
            "mist": 6,
            "pulse": 1.6,
            "mistUp": [
              4,
              10
            ],
            "mistSize": [
              1.4,
              5
            ],
            "lens": 0.9
          },
          "crash": {
            "ref": 3.5,
            "drops": 120,
            "up": [
              6,
              13
            ],
            "out": [
              2,
              6
            ],
            "size": [
              0.09,
              0.22
            ],
            "life": [
              1,
              2
            ],
            "mist": 8,
            "pulse": 2,
            "mistUp": [
              3,
              8
            ],
            "mistSize": [
              1.6,
              6
            ],
            "lens": 1
          }
        },
        "maxSplashDrops": 120,
        "pulseSpeed": 6,
        "pulseLife": 2.6,
        "trailAgl": 22,
        "trailFrom": 70,
        "trailFull": 120,
        "trailRate": 900,
        "trailMistRate": 40,
        "trailBehind": [
          6,
          26
        ],
        "trailUp": [
          4,
          12
        ],
        "trailSide": [
          1.5,
          6
        ],
        "trailSize": [
          0.12,
          0.3
        ],
        "trailMistSize": [
          2.5,
          10
        ],
        "trailLife": [
          0.6,
          1.3
        ],
        "trailMistLife": [
          1.6,
          2.8
        ],
        "trailInherit": [
          0.12,
          0.08
        ],
        "trailJitter": 2,
        "lens": true,
        "lensRate": 1.4,
        "lensDecay": 0.3,
        "lensCells": 7,
        "lensRange": 7,
        "lensWashHeight": [
          4,
          14
        ],
        "lensEye": 1.5,
        "lensUnder": 0.1,
        "lensNear": 2,
        "lensSelf": 8,
        "splashMaxDist": 700,
        "splashSkMax": 1.6,
        "splashR0": 0.15,
        "splashMistLife": [
          1.6,
          3
        ],
        "mobile": {
          "maxDrops": 384,
          "maxMist": 48,
          "maxPulses": 2
        }
      },
      "weather": {
        "enabled": true,
        "slotSec": 180,
        "transitionSec": 45,
        "resetP": 0.08,
        "hub": "cloudy",
        "resetScanCap": 512,
        "cycleSlotSec": 20,
        "jumpSec": 2,
        "solo": {
          "offsetSpan": 1000000,
          "startState": "auto"
        },
        "online": {
          "enabled": true,
          "drift": false,
          "clockSlew": 0.5,
          "clockSnap": 30
        },
        "toastMs": 3500,
        "levelDefaults": {
          "enabled": "city",
          "cloudH": 1600,
          "cirrusH": 8000,
          "scaleA": 12000,
          "scaleB": 3000,
          "windDir": 250
        },
        "levels": {
          "arena01": {
            "enabled": false
          },
          "manhattan": {
            "enabled": false
          }
        },
        "wet": {
          "riseSec": 60,
          "drySec": 240,
          "puddleLight": 0.05,
          "puddleStorm": 0.3,
          "maskTile": 6,
          "darken": 0.3,
          "rough": 0.5,
          "roughMottle": 1.4,
          "mottle": [
            0.55,
            0.9
          ],
          "puddleRough": 0.05,
          "puddleDark": 0.35,
          "puddleEdge": 0.04,
          "puddleKnee": 0.8,
          "farDarken": 0.28
        },
        "wind": {
          "dirDriftDegPerMin": 6,
          "dirAmpDeg": 40,
          "gustAmp": 0.35,
          "gustPeriod": 23
        },
        "drift": {
          "chute": 0.6,
          "heli": 0.25,
          "jet": 0.15,
          "heliAglFrom": 5,
          "heliAglFull": 20,
          "jetAglFrom": 30
        },
        "lightning": {
          "near": 1500,
          "nearShare": 0.3,
          "minDist": 400,
          "maxDist": 8000,
          "inCloudFrom": 3000,
          "flashMs": [
            60,
            140
          ],
          "doubleChance": 0.4,
          "boltShowMs": 180,
          "sound": 343,
          "thunderRef": 40,
          "maxGap": 1,
          "queue": 4
        },
        "enemy": {
          "minAttackMul": 0.7
        },
        "haze": {
          "denseFrom": 0.6,
          "bandDeg": 4,
          "fadeDeg": 12
        },
        "env": {
          "minScale": 0.25
        },
        "view": {
          "cloudWind": 2.2,
          "cloudWindB": 1.2,
          "cirrusWind": 2.5,
          "domeRadius": 450,
          "domeSegments": [
            48,
            24
          ],
          "farOverFog": 1.15,
          "startToastSec": 2,
          "startText": "いまの天気",
          "toastBlend": 0.3,
          "toastEnd": {
            "rain": 0.03,
            "fog": 0.9,
            "lightning": 0
          },
          "envHz": 2,
          "envStep": 0.02,
          "hemiSky": "#a4a7ae",
          "hemiGround": "#5a5856",
          "hemiOver": 1,
          "fallSpeed": 9,
          "rainWind": 0.5,
          "streakMax": 3,
          "rainColor": "#c9ced8",
          "rainLight": 0.8,
          "rainSun": 0.05,
          "rainFadeIn": 0.12,
          "rainOpMin": 0.7,
          "speedFadeFrom": 0.7,
          "cloudFadeFrom": 0.8,
          "indoorHz": 4,
          "indoorCeiling": 60,
          "indoorRadius": 4,
          "indoorOpenK": 2.5,
          "indoorFadeSec": 0.4,
          "splashLife": 0.4,
          "splashSize": 0.34,
          "splashBright": 2,
          "splashJitter": 0.6,
          "splashCapK": 1.5,
          "splashMinR": 2,
          "splashCover": 60,
          "splashMaxDy": 30,
          "rippleCells": [
            0.8,
            0.45,
            0.25
          ],
          "rippleWidth": 0.025,
          "rippleFull": [
            0.4,
            0.6,
            0.9
          ],
          "rippleOnset": 0.15,
          "rippleDist": [
            25,
            40
          ],
          "rippleNear": [
            4,
            7
          ],
          "rippleNormal": 0.9,
          "rippleDot": 1.5,
          "rippleDotSize": 0.06,
          "rippleLight": 1.5,
          "clockRebase": 256,
          "flashHemi": 1.4,
          "flashSun": 0.4,
          "flashExposure": 0.25,
          "flashFog": 0.6,
          "flashWater": 1,
          "flashDome": 0.6,
          "flashFarK": 0.3,
          "flashInCloud": 0.7,
          "flashGap": [
            0.06,
            0.12
          ],
          "flashSecond": 0.7,
          "flashColor": "#dfe4ff",
          "flashIndoor": 0.02,
          "flashWindow": 0.5,
          "flashHud": 0.35,
          "flashHold": 0.35,
          "flashElev": 0.25,
          "flashDomeBase": 0.25,
          "flashDomePow": 3,
          "boltWidth": 0.25,
          "boltNear": 1.6,
          "boltFar": 0.5,
          "boltInCloud": 0.7,
          "boltCloudBottom": 0.5,
          "boltPulseMin": 0.45,
          "boltReplace": 0.8,
          "boltHaze": 0.85
        },
        "states": {
          "clear": {
            "weight": 4,
            "minSlots": 2,
            "next": {
              "clear": 5,
              "cloudy": 3,
              "fog": 1
            },
            "name": "晴れ",
            "toast": "晴れてきた",
            "toastFrom": {
              "fog": "霧が晴れた",
              "rain": "雨がやんで晴れてきた",
              "storm": "雨がやんで晴れてきた"
            },
            "icon": "sun",
            "clouds": {
              "coverage": 0.16,
              "softness": 0.1,
              "erode": 0.3,
              "overcast": 0,
              "cirrus": 0.55,
              "lit": "#ffaf80",
              "shade": "#41364d",
              "ov": "#413c47",
              "cir": "#e5906f",
              "hazeDist": 22000
            },
            "bgMul": 1,
            "sunMul": 1,
            "hemiMul": 1,
            "exposure": 1,
            "sun": null,
            "fog": null,
            "fogMul": 1,
            "farMul": 1,
            "envMul": 1,
            "rain": 0,
            "wet": 0,
            "wind": 4,
            "lightningPerMin": 0,
            "vis": 1,
            "skyRefl": 1,
            "glint": 1
          },
          "cloudy": {
            "weight": 4,
            "minSlots": 2,
            "next": {
              "cloudy": 3,
              "clear": 3,
              "rain": 2,
              "fog": 1
            },
            "name": "曇り",
            "toast": "曇ってきた",
            "toastFrom": {
              "rain": "雨がやんだ",
              "storm": "雨がやんだ",
              "fog": "霧が晴れてきた",
              "snow": "雪がやんだ"
            },
            "icon": "cloud",
            "clouds": {
              "coverage": 0.55,
              "softness": 0.12,
              "erode": 0.3,
              "overcast": 0,
              "cirrus": 0.3,
              "lit": "#e28d64",
              "shade": "#25202e",
              "ov": "#322e39",
              "cir": "#d0866f",
              "hazeDist": 18000
            },
            "bgMul": 0.85,
            "sunMul": 0.55,
            "hemiMul": 0.95,
            "exposure": 0.97,
            "sun": null,
            "fog": "#a8857c",
            "fogMul": 1,
            "farMul": 1,
            "envMul": 0.7,
            "rain": 0,
            "wet": 0,
            "wind": 6,
            "lightningPerMin": 0,
            "vis": 1,
            "skyRefl": 0.85,
            "glint": 0.5
          },
          "rain": {
            "weight": 3,
            "minSlots": 2,
            "maxSlots": 5,
            "next": {
              "rain": 4,
              "cloudy": 3,
              "storm": 1.5,
              "fog": 0.5
            },
            "name": "雨",
            "toast": "雨が降ってきた",
            "toastFrom": {
              "storm": "雷がおさまった"
            },
            "icon": "rain",
            "clouds": {
              "coverage": 0.85,
              "softness": 0.2,
              "erode": 0.2,
              "overcast": 0.92,
              "cirrus": 0,
              "lit": "#6a6262",
              "shade": "#23232a",
              "ov": "#34353c",
              "cir": "#5a5a5a",
              "hazeDist": 9000
            },
            "bgMul": 0.45,
            "sunMul": 0.15,
            "hemiMul": 0.7,
            "exposure": 0.9,
            "sun": "#b9b2ac",
            "fog": "#5e5f66",
            "fogMul": 0.6,
            "farMul": 1,
            "envMul": 0.4,
            "rain": 0.55,
            "wet": 0.8,
            "wind": 7,
            "lightningPerMin": 0,
            "vis": 0.8,
            "skyRefl": 0.5,
            "glint": 0.15
          },
          "storm": {
            "weight": 1,
            "minSlots": 1,
            "maxSlots": 3,
            "next": {
              "storm": 2,
              "rain": 4,
              "cloudy": 1
            },
            "name": "雷雨",
            "toast": "雷雨になった",
            "icon": "bolt",
            "clouds": {
              "coverage": 0.95,
              "softness": 0.22,
              "erode": 0.2,
              "overcast": 1,
              "cirrus": 0,
              "lit": "#3a3640",
              "shade": "#121217",
              "ov": "#1c1d23",
              "cir": "#303030",
              "hazeDist": 7000
            },
            "bgMul": 0.25,
            "sunMul": 0.05,
            "hemiMul": 0.55,
            "exposure": 0.85,
            "sun": "#a7a6b0",
            "fog": "#3a3b42",
            "fogMul": 0.5,
            "farMul": 1,
            "envMul": 0.3,
            "rain": 1,
            "wet": 1,
            "wind": 12,
            "lightningPerMin": 5,
            "vis": 0.7,
            "skyRefl": 0.35,
            "glint": 0
          },
          "fog": {
            "weight": 2,
            "minSlots": 2,
            "maxSlots": 4,
            "next": {
              "fog": 3,
              "cloudy": 3,
              "clear": 2
            },
            "name": "霧",
            "toast": "霧が出てきた",
            "toastFrom": {
              "rain": "雨がやんで霧が出てきた",
              "storm": "雨がやんで霧が出てきた"
            },
            "icon": "fog",
            "clouds": {
              "coverage": 0.4,
              "softness": 0.25,
              "erode": 0.15,
              "overcast": 0.8,
              "cirrus": 0,
              "lit": "#b3aeb0",
              "shade": "#7c7980",
              "ov": "#8f8c8f",
              "cir": "#999999",
              "hazeDist": 2500
            },
            "bgMul": 0.6,
            "sunMul": 0.35,
            "hemiMul": 0.9,
            "exposure": 0.95,
            "sun": "#d8d0c8",
            "fog": "#8e8b8d",
            "fogMul": 0.25,
            "farMul": 0.3,
            "envMul": 0.45,
            "rain": 0,
            "wet": 0.3,
            "wind": 2,
            "lightningPerMin": 0,
            "vis": 0.55,
            "skyRefl": 0.4,
            "glint": 0.2
          },
          "snow": {
            "weight": 0,
            "minSlots": 2,
            "maxSlots": 4,
            "next": {
              "snow": 3,
              "cloudy": 3
            },
            "name": "雪",
            "toast": "雪が降ってきた",
            "icon": "snow",
            "clouds": {
              "coverage": 0.9,
              "softness": 0.25,
              "erode": 0.2,
              "overcast": 0.9,
              "cirrus": 0,
              "lit": "#d6d4dc",
              "shade": "#8a8c98",
              "ov": "#a4a6b0",
              "cir": "#bbbbbb",
              "hazeDist": 6000
            },
            "bgMul": 0.55,
            "sunMul": 0.25,
            "hemiMul": 0.9,
            "exposure": 0.97,
            "sun": "#dcdce6",
            "fog": "#b4b6be",
            "fogMul": 0.55,
            "farMul": 1,
            "envMul": 0.5,
            "rain": 0,
            "snow": 1,
            "wet": 0.2,
            "wind": 5,
            "lightningPerMin": 0,
            "vis": 0.75,
            "skyRefl": 0.5,
            "glint": 0.2
          }
        }
      },
      "render": {
        "fov": 74,
        "view": {
          "hemi": 1.5,
          "sun": 0.8,
          "fill": 2,
          "rim": 1.1,
          "rimColor": "#bcd4ff",
          "rimPos": [
            -0.6,
            0.8,
            1.2
          ],
          "rimTarget": [
            0.12,
            -0.14,
            -0.4
          ],
          "arms": "models/arms.glb"
        },
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
          "gpuSweep": {
            "every": 2,
            "after": 20,
            "max": 24,
            "gateMB": 8,
            "keep": [
              "sky/",
              "weather",
              "water/",
              "arms.glb",
              "knife.glb"
            ]
          },
          "maxPixelRatio": 1.75,
          "shadowMapSize": 1024,
          "bloomStrength": 0.3,
          "anisotropy": 4,
          "ssao": false,
          "jetLight": false,
          "fxMaxParticles": 120,
          "look": {
            "interiors": {
              "maxShell": 1200,
              "cardMax": 400,
              "cardDist": 25,
              "dressDist": 5,
              "maxGlass": 250,
              "maxFoliage": 160
            }
          },
          "boats": {
            "detailDist": 300,
            "maxDetailShips": 2,
            "wakePoints": 768,
            "sprayMax": 64,
            "shipShadows": false
          }
        },
        "boats": {
          "detailDist": 450,
          "maxDetailShips": 4,
          "shipShadows": false,
          "wakes": true,
          "wakePoints": 1536,
          "spray": true,
          "sprayMax": 128,
          "windowEmissive": 1.4,
          "lid": true,
          "stencilBit": 2,
          "lodHz": 4
        },
        "textures": true,
        "jetLight": true,
        "fxMaxParticles": 400,
        "anisotropy": 8,
        "gpuTextures": {
          "releaseAfter": 4,
          "warmPerFrame": 1,
          "warmScan": 0.25,
          "hideMax": 2,
          "warmMBPerFrame": 8,
          "warmDelayFrames": 2,
          "landmarkMax": 3
        },
        "vignette": 0.35,
        "ssao": false,
        "props": true,
        "hdrBuffer": true,
        "look": {
          "enabled": true,
          "grade": {
            "outdoor": {
              "gain": 1,
              "contrast": 1.12,
              "pivot": 0.42,
              "saturation": 1.04,
              "vibrance": 0.22,
              "lift": 0.015,
              "liftColor": "#0d1a26",
              "shadowTint": "#2a4a66",
              "shadowAmt": 0.08,
              "highTint": "#ffb066",
              "highAmt": 0.06,
              "vignette": 0.3
            },
            "indoor": {
              "gain": 1.15,
              "contrast": 1.16,
              "vibrance": 0.3,
              "shadowTint": "#1f3550",
              "shadowAmt": 0.06,
              "highTint": "#ffcf99",
              "highAmt": 0.05
            }
          },
          "indoor": {
            "hemiSky": "#fff0dc",
            "hemiGround": "#3a3530",
            "lift": 0.05,
            "liftOut": 0,
            "furnEnv": 0.35,
            "tau": 0.5
          },
          "interiors": {
            "panelColor": "#fff4e0",
            "panelIntensity": 2.2,
            "indoorLift": 0.05,
            "maxShell": 1800,
            "atlas": 1024,
            "atlasMs": 2,
            "screenGlow": 0.8,
            "contact": 0.58,
            "edge": 0.3,
            "bevel": 0.18,
            "edgeWidth": 0.015,
            "lightBake": 0.45,
            "coolNear": 3,
            "coolMix": 0.08,
            "coolColor": "#cfe0ff",
            "poolRadius": {
              "default": 1.8,
              "office": 1.5,
              "shop": 1.5,
              "warehouse": 4,
              "workshop": 4,
              "apartment": 2.2,
              "lobby": 2
            },
            "cards": true,
            "cardMax": 700,
            "cardDist": 35,
            "poolGain": {
              "default": 4,
              "office": 5,
              "lobby": 1.2,
              "shop": 0.7,
              "apartment": 2.2
            },
            "blobGain": -0.32,
            "blobMargin": 0.3,
            "windowFill": "#a8c8ff",
            "windowFillGain": {
              "default": 0.45,
              "lobby": 0.12,
              "shop": 0.12
            },
            "windowFillDepth": 1.6,
            "sunColor": "#ffb070",
            "sunGain": {
              "default": 0.9,
              "lobby": 0.25,
              "shop": 0.25
            },
            "sunMax": 6,
            "sunFacing": 0.2,
            "dressDist": 8,
            "glass": true,
            "maxGlass": 400,
            "glassColor": "#9fd0d8",
            "glassOpacity": 0.28,
            "foliage": true,
            "maxFoliage": 300,
            "deskPoolGain": 0.35
          },
          "levels": {
            "arena01": {}
          }
        },
        "cine": {
          "applyCaps": false,
          "classes": {
            "_post": "post = render scale of the post chain (EffectComposer) in CSS px x post; null = the renderer DPR. Capped by the renderer DPR and px; never below 1; saver / ?look=0 = 1",
            "low": {
              "px": 0.75,
              "dpr": 2,
              "gpuMB": 180,
              "post": 1
            },
            "phone": {
              "px": 1.1,
              "dpr": 3,
              "gpuMB": 260,
              "post": 1.3
            },
            "phonePlus": {
              "px": 1.1,
              "dpr": 3,
              "gpuMB": 290,
              "post": 1.3
            },
            "tablet": {
              "px": 2.2,
              "dpr": 2,
              "gpuMB": 320,
              "post": 1.15
            },
            "tabletPro": {
              "px": 3.2,
              "dpr": 2,
              "gpuMB": 600,
              "post": 1.25
            },
            "desktop": {
              "px": 4,
              "dpr": 2,
              "gpuMB": 1000,
              "post": null
            }
          },
          "detect": {
            "lowRamGB": 3,
            "plusRamGB": 8,
            "tabletMinCss": 600,
            "ios16Gpu": 150,
            "ios16Audio": 90
          },
          "ladder": {
            "windowFrames": 60,
            "windowEvery": 60,
            "sustain": 3,
            "gapK": 2.5,
            "idleSec": 5,
            "camSec": 5,
            "camMoveM": 2,
            "capped": [
              [
                33.3,
                1
              ],
              [
                16.7,
                0.5
              ]
            ],
            "cpuCapped": 10,
            "cpuBound": 12,
            "gpuP90": 18.5,
            "gpuCpuMax": 10,
            "persistLaunches": 2,
            "persistDays": 7,
            "decayDays": 7,
            "visibleBefore": 2,
            "memFrac": 0.9,
            "memCooldown": 30
          },
          "online": {
            "fullIn": 100,
            "fullOut": 124,
            "fireEscapeDist": 25,
            "detailDist": 45,
            "ladderOff": [
              4,
              5,
              9
            ],
            "lens": false,
            "wrecks": false,
            "vignette": 0.35
          }
        },
        "devices": {
          "_note": "model identifier -> [RAM GB, name]. Unconfirmed identifiers are left out and take the unknown path (iPhone -> phone, iPad -> tablet): iPhone 17e, iPad Pro (M5), iPad Air (M4). An unknown identifier older than the oldest one listed here (lower major number) is low",
          "iPhone8,1": [
            2,
            "iPhone 6s"
          ],
          "iPhone8,2": [
            2,
            "iPhone 6s Plus"
          ],
          "iPhone8,4": [
            2,
            "iPhone SE"
          ],
          "iPhone9,1": [
            2,
            "iPhone 7"
          ],
          "iPhone9,3": [
            2,
            "iPhone 7"
          ],
          "iPhone9,2": [
            3,
            "iPhone 7 Plus"
          ],
          "iPhone9,4": [
            3,
            "iPhone 7 Plus"
          ],
          "iPod9,1": [
            2,
            "iPod touch (7th)"
          ],
          "iPad5,1": [
            2,
            "iPad mini 4"
          ],
          "iPad5,2": [
            2,
            "iPad mini 4"
          ],
          "iPad5,3": [
            2,
            "iPad Air 2"
          ],
          "iPad5,4": [
            2,
            "iPad Air 2"
          ],
          "iPad6,3": [
            2,
            "iPad Pro 9.7"
          ],
          "iPad6,4": [
            2,
            "iPad Pro 9.7"
          ],
          "iPad6,7": [
            4,
            "iPad Pro 12.9 (1st)"
          ],
          "iPad6,8": [
            4,
            "iPad Pro 12.9 (1st)"
          ],
          "iPad6,11": [
            2,
            "iPad (5th)"
          ],
          "iPad6,12": [
            2,
            "iPad (5th)"
          ],
          "iPad7,1": [
            4,
            "iPad Pro 12.9 (2nd)"
          ],
          "iPad7,2": [
            4,
            "iPad Pro 12.9 (2nd)"
          ],
          "iPad7,3": [
            4,
            "iPad Pro 10.5"
          ],
          "iPad7,4": [
            4,
            "iPad Pro 10.5"
          ],
          "iPad7,5": [
            2,
            "iPad (6th)"
          ],
          "iPad7,6": [
            2,
            "iPad (6th)"
          ],
          "iPhone10,1": [
            2,
            "iPhone 8"
          ],
          "iPhone10,4": [
            2,
            "iPhone 8"
          ],
          "iPhone10,2": [
            3,
            "iPhone 8 Plus"
          ],
          "iPhone10,5": [
            3,
            "iPhone 8 Plus"
          ],
          "iPhone10,3": [
            3,
            "iPhone X"
          ],
          "iPhone10,6": [
            3,
            "iPhone X"
          ],
          "iPhone11,2": [
            4,
            "iPhone XS"
          ],
          "iPhone11,4": [
            4,
            "iPhone XS Max"
          ],
          "iPhone11,6": [
            4,
            "iPhone XS Max"
          ],
          "iPhone11,8": [
            3,
            "iPhone XR"
          ],
          "iPhone12,1": [
            4,
            "iPhone 11"
          ],
          "iPhone12,3": [
            4,
            "iPhone 11 Pro"
          ],
          "iPhone12,5": [
            4,
            "iPhone 11 Pro Max"
          ],
          "iPhone12,8": [
            3,
            "iPhone SE (2nd)"
          ],
          "iPhone13,1": [
            4,
            "iPhone 12 mini"
          ],
          "iPhone13,2": [
            4,
            "iPhone 12"
          ],
          "iPhone13,3": [
            6,
            "iPhone 12 Pro"
          ],
          "iPhone13,4": [
            6,
            "iPhone 12 Pro Max"
          ],
          "iPhone14,4": [
            4,
            "iPhone 13 mini"
          ],
          "iPhone14,5": [
            4,
            "iPhone 13"
          ],
          "iPhone14,2": [
            6,
            "iPhone 13 Pro"
          ],
          "iPhone14,3": [
            6,
            "iPhone 13 Pro Max"
          ],
          "iPhone14,6": [
            4,
            "iPhone SE (3rd)"
          ],
          "iPhone14,7": [
            6,
            "iPhone 14"
          ],
          "iPhone14,8": [
            6,
            "iPhone 14 Plus"
          ],
          "iPhone15,2": [
            6,
            "iPhone 14 Pro"
          ],
          "iPhone15,3": [
            6,
            "iPhone 14 Pro Max"
          ],
          "iPhone15,4": [
            6,
            "iPhone 15"
          ],
          "iPhone15,5": [
            6,
            "iPhone 15 Plus"
          ],
          "iPhone16,1": [
            8,
            "iPhone 15 Pro"
          ],
          "iPhone16,2": [
            8,
            "iPhone 15 Pro Max"
          ],
          "iPhone17,3": [
            8,
            "iPhone 16"
          ],
          "iPhone17,4": [
            8,
            "iPhone 16 Plus"
          ],
          "iPhone17,1": [
            8,
            "iPhone 16 Pro"
          ],
          "iPhone17,2": [
            8,
            "iPhone 16 Pro Max"
          ],
          "iPhone17,5": [
            8,
            "iPhone 16e"
          ],
          "iPhone18,3": [
            8,
            "iPhone 17"
          ],
          "iPhone18,4": [
            12,
            "iPhone Air"
          ],
          "iPhone18,1": [
            12,
            "iPhone 17 Pro"
          ],
          "iPhone18,2": [
            12,
            "iPhone 17 Pro Max"
          ],
          "iPad7,11": [
            3,
            "iPad (7th)"
          ],
          "iPad7,12": [
            3,
            "iPad (7th)"
          ],
          "iPad11,6": [
            3,
            "iPad (8th)"
          ],
          "iPad11,7": [
            3,
            "iPad (8th)"
          ],
          "iPad12,1": [
            3,
            "iPad (9th)"
          ],
          "iPad12,2": [
            3,
            "iPad (9th)"
          ],
          "iPad13,18": [
            4,
            "iPad (10th)"
          ],
          "iPad13,19": [
            4,
            "iPad (10th)"
          ],
          "iPad15,7": [
            6,
            "iPad (A16)"
          ],
          "iPad15,8": [
            6,
            "iPad (A16)"
          ],
          "iPad11,1": [
            3,
            "iPad mini (5th)"
          ],
          "iPad11,2": [
            3,
            "iPad mini (5th)"
          ],
          "iPad14,1": [
            4,
            "iPad mini (6th)"
          ],
          "iPad14,2": [
            4,
            "iPad mini (6th)"
          ],
          "iPad16,1": [
            8,
            "iPad mini (A17 Pro)"
          ],
          "iPad16,2": [
            8,
            "iPad mini (A17 Pro)"
          ],
          "iPad11,3": [
            3,
            "iPad Air (3rd)"
          ],
          "iPad11,4": [
            3,
            "iPad Air (3rd)"
          ],
          "iPad13,1": [
            4,
            "iPad Air (4th)"
          ],
          "iPad13,2": [
            4,
            "iPad Air (4th)"
          ],
          "iPad13,16": [
            8,
            "iPad Air (M1)"
          ],
          "iPad13,17": [
            8,
            "iPad Air (M1)"
          ],
          "iPad14,8": [
            8,
            "iPad Air 11 (M2)"
          ],
          "iPad14,9": [
            8,
            "iPad Air 11 (M2)"
          ],
          "iPad14,10": [
            8,
            "iPad Air 13 (M2)"
          ],
          "iPad14,11": [
            8,
            "iPad Air 13 (M2)"
          ],
          "iPad15,3": [
            8,
            "iPad Air 11 (M3)"
          ],
          "iPad15,4": [
            8,
            "iPad Air 11 (M3)"
          ],
          "iPad15,5": [
            8,
            "iPad Air 13 (M3)"
          ],
          "iPad15,6": [
            8,
            "iPad Air 13 (M3)"
          ],
          "iPad8,1": [
            4,
            "iPad Pro 11 (1st)"
          ],
          "iPad8,2": [
            6,
            "iPad Pro 11 (1st) 1TB"
          ],
          "iPad8,3": [
            4,
            "iPad Pro 11 (1st)"
          ],
          "iPad8,4": [
            6,
            "iPad Pro 11 (1st) 1TB"
          ],
          "iPad8,5": [
            4,
            "iPad Pro 12.9 (3rd)"
          ],
          "iPad8,6": [
            6,
            "iPad Pro 12.9 (3rd) 1TB"
          ],
          "iPad8,7": [
            4,
            "iPad Pro 12.9 (3rd)"
          ],
          "iPad8,8": [
            6,
            "iPad Pro 12.9 (3rd) 1TB"
          ],
          "iPad8,9": [
            6,
            "iPad Pro 11 (2nd)"
          ],
          "iPad8,10": [
            6,
            "iPad Pro 11 (2nd)"
          ],
          "iPad8,11": [
            6,
            "iPad Pro 12.9 (4th)"
          ],
          "iPad8,12": [
            6,
            "iPad Pro 12.9 (4th)"
          ],
          "iPad13,4": [
            8,
            "iPad Pro 11 (M1)"
          ],
          "iPad13,5": [
            8,
            "iPad Pro 11 (M1)"
          ],
          "iPad13,6": [
            8,
            "iPad Pro 11 (M1)"
          ],
          "iPad13,7": [
            8,
            "iPad Pro 11 (M1)"
          ],
          "iPad13,8": [
            8,
            "iPad Pro 12.9 (M1)"
          ],
          "iPad13,9": [
            8,
            "iPad Pro 12.9 (M1)"
          ],
          "iPad13,10": [
            8,
            "iPad Pro 12.9 (M1)"
          ],
          "iPad13,11": [
            8,
            "iPad Pro 12.9 (M1)"
          ],
          "iPad14,3": [
            8,
            "iPad Pro 11 (M2)"
          ],
          "iPad14,4": [
            8,
            "iPad Pro 11 (M2)"
          ],
          "iPad14,5": [
            8,
            "iPad Pro 12.9 (M2)"
          ],
          "iPad14,6": [
            8,
            "iPad Pro 12.9 (M2)"
          ],
          "iPad16,3": [
            8,
            "iPad Pro 11 (M4)"
          ],
          "iPad16,4": [
            8,
            "iPad Pro 11 (M4)"
          ],
          "iPad16,5": [
            8,
            "iPad Pro 13 (M4)"
          ],
          "iPad16,6": [
            8,
            "iPad Pro 13 (M4)"
          ]
        },
        "screens": {
          "_note": "Web 版の機種の推定（MR.Cine.guessModel）: screen の短い辺 x 長い辺 @ devicePixelRatio → 同じ画面の機種 id（RAM は devices）。拡大表示（Display Zoom）だと小さい機種の値になる",
          "320x568@2": [
            "iPhone8,4",
            "iPod9,1"
          ],
          "375x667@2": [
            "iPhone8,1",
            "iPhone9,1",
            "iPhone10,1",
            "iPhone12,8",
            "iPhone14,6"
          ],
          "414x736@3": [
            "iPhone8,2",
            "iPhone9,2",
            "iPhone10,2"
          ],
          "375x812@3": [
            "iPhone10,3",
            "iPhone11,2",
            "iPhone12,3",
            "iPhone13,1",
            "iPhone14,4"
          ],
          "414x896@2": [
            "iPhone11,8",
            "iPhone12,1"
          ],
          "414x896@3": [
            "iPhone11,6",
            "iPhone12,5"
          ],
          "390x844@3": [
            "iPhone13,2",
            "iPhone13,3",
            "iPhone14,5",
            "iPhone14,2",
            "iPhone14,7",
            "iPhone17,5"
          ],
          "428x926@3": [
            "iPhone13,4",
            "iPhone14,3",
            "iPhone14,8"
          ],
          "393x852@3": [
            "iPhone15,2",
            "iPhone15,4",
            "iPhone16,1",
            "iPhone17,3"
          ],
          "430x932@3": [
            "iPhone15,3",
            "iPhone15,5",
            "iPhone16,2",
            "iPhone17,4"
          ],
          "402x874@3": [
            "iPhone17,1",
            "iPhone18,3",
            "iPhone18,1"
          ],
          "440x956@3": [
            "iPhone17,2",
            "iPhone18,2"
          ],
          "420x912@3": [
            "iPhone18,4"
          ],
          "768x1024@2": [
            "iPad5,1",
            "iPad5,3",
            "iPad6,3",
            "iPad6,11",
            "iPad7,5",
            "iPad11,1"
          ],
          "810x1080@2": [
            "iPad7,11",
            "iPad11,6",
            "iPad12,1"
          ],
          "834x1112@2": [
            "iPad7,3",
            "iPad11,3"
          ],
          "744x1133@2": [
            "iPad14,1",
            "iPad16,1"
          ],
          "820x1180@2": [
            "iPad13,1",
            "iPad13,16",
            "iPad13,18",
            "iPad14,8"
          ],
          "834x1194@2": [
            "iPad8,1",
            "iPad8,2",
            "iPad8,9",
            "iPad13,4",
            "iPad14,3"
          ],
          "834x1210@2": [
            "iPad16,3"
          ],
          "1024x1366@2": [
            "iPad6,7",
            "iPad7,1",
            "iPad8,5",
            "iPad8,6",
            "iPad8,11",
            "iPad13,8",
            "iPad14,5",
            "iPad14,10"
          ],
          "1032x1376@2": [
            "iPad16,5"
          ]
        },
        "tod": {
          "_note": "time of day (www/js/tod.js, plan time-of-day.md). One preset per game: online / arena / harness = dusk, else setting mirrsona.tod or default (auto = weights by seed). dusk {} = the level sky and render values unchanged. Keys are the base under weather: sky (over level sky; disc false = no sun disc, moon = stars when no image), hemi.mul, fog.mul (city altitude fogNear/fogFar), exposure (x render.exposure), grade (over render.look.grade), windows.glow (x windowEmissive / farWindowGlow), windows.lit (x farWindowLit / farlook litOffice / litHome, max 1), lamps (x propEmissive), landmarkNight (0..1, replaces render.city.landmarkNight.night), enemySight (x solo AI detect / attack range), weather (weather_view.js: the weather state colours are tuned for dusk; per key lit / shade / cir (default clouds) / ov / fog / haze (default fog) / sun / rain = { sat (0 = grey of the linear luminance, 1 = as is), mul (number or linear [r, g, b]) }, hemiSky / hemiGround (sRGB hex, the overcast hemisphere colours); no block = unchanged)",
          "default": "auto",
          "weights": {
            "dusk": 3,
            "golden": 2,
            "noon": 2,
            "haze": 2,
            "blue": 1,
            "night": 2
          },
          "online": "dusk",
          "arena": "dusk",
          "labels": {
            "auto": "おまかせ",
            "dusk": "夕方",
            "golden": "黄昏",
            "noon": "昼",
            "haze": "かすみ",
            "blue": "夜明け前",
            "night": "夜"
          },
          "presets": {
            "dusk": {},
            "golden": {
              "sky": {
                "zenith": "#2f5a8e",
                "horizon": "#f6cf92",
                "ground": "#4a3b2e",
                "sunColor": "#ffcc88",
                "sunDir": [
                  -0.757,
                  0.208,
                  -0.619
                ],
                "sunIntensity": 2.4,
                "background": "sky/golden_bg.jpg",
                "env": "sky/golden_env.jpg"
              },
              "hemi": {
                "mul": 1
              },
              "fog": {
                "mul": 1.1
              },
              "exposure": 1,
              "grade": {
                "outdoor": {
                  "highTint": "#ffb870",
                  "highAmt": 0.08,
                  "saturation": 1.06
                }
              },
              "windows": {
                "glow": 0.75,
                "lit": 0.6
              },
              "lamps": 0.6,
              "landmarkNight": 0.35,
              "enemySight": 1
            },
            "noon": {
              "sky": {
                "zenith": "#4a7fcf",
                "horizon": "#c2d8ee",
                "ground": "#5a5550",
                "sunColor": "#fff4e2",
                "sunDir": [
                  -0.387,
                  0.866,
                  -0.317
                ],
                "sunIntensity": 3,
                "background": "sky/noon_bg.jpg",
                "env": "sky/noon_env.jpg"
              },
              "hemi": {
                "mul": 1.15
              },
              "fog": {
                "mul": 1.4
              },
              "exposure": 0.68,
              "grade": {
                "outdoor": {
                  "contrast": 1.08,
                  "highTint": "#fff2dc",
                  "highAmt": 0.03,
                  "shadowTint": "#3a5068",
                  "shadowAmt": 0.06
                }
              },
              "weather": {
                "clouds": {
                  "sat": 0.08,
                  "mul": [
                    1.72,
                    1.78,
                    1.9
                  ]
                },
                "shade": {
                  "sat": 0,
                  "mul": [
                    4.4,
                    4.7,
                    5.4
                  ]
                },
                "ov": {
                  "sat": 0.5,
                  "mul": 2.2
                },
                "fog": {
                  "sat": 0.25,
                  "mul": [
                    1.15,
                    1.2,
                    1.3
                  ]
                },
                "sun": {
                  "sat": 0.1,
                  "mul": 1
                },
                "hemiSky": "#b4b8c0",
                "hemiGround": "#6a6866"
              },
              "windows": {
                "glow": 0.25,
                "lit": 0.15
              },
              "lamps": 0.3,
              "landmarkNight": 0.1,
              "enemySight": 1
            },
            "haze": {
              "sky": {
                "zenith": "#8a9db0",
                "horizon": "#e8d2ae",
                "ground": "#5b5045",
                "sunColor": "#ffe0b0",
                "sunDir": [
                  -0.67,
                  0.5,
                  -0.548
                ],
                "sunIntensity": 2.2,
                "background": "sky/haze_bg.jpg",
                "env": "sky/haze_env.jpg"
              },
              "hemi": {
                "mul": 1.1
              },
              "fog": {
                "mul": 0.6
              },
              "exposure": 0.92,
              "grade": {
                "outdoor": {
                  "saturation": 0.96,
                  "highTint": "#ffcf8a",
                  "highAmt": 0.08,
                  "lift": 0.03,
                  "liftColor": "#3a3020"
                }
              },
              "weather": {
                "clouds": {
                  "sat": 0.6,
                  "mul": 1.3
                },
                "ov": {
                  "sat": 0.7,
                  "mul": 1.3
                },
                "fog": {
                  "sat": 0.7,
                  "mul": 1.1
                }
              },
              "windows": {
                "glow": 0.4,
                "lit": 0.3
              },
              "lamps": 0.4,
              "landmarkNight": 0.2,
              "enemySight": 0.9
            },
            "blue": {
              "sky": {
                "zenith": "#0e1c3d",
                "horizon": "#5a6c9a",
                "ground": "#1e2230",
                "sunColor": "#8fa6d8",
                "sunDir": [
                  -0.77,
                  0.05,
                  -0.63
                ],
                "sunIntensity": 0.25,
                "imageSunEl": -4,
                "disc": false,
                "background": "sky/blue_bg.jpg",
                "env": "sky/blue_env.jpg"
              },
              "hemi": {
                "mul": 0.6
              },
              "fog": {
                "mul": 0.9
              },
              "exposure": 1.3,
              "grade": {
                "outdoor": {
                  "shadowTint": "#1a2c55",
                  "shadowAmt": 0.12,
                  "highTint": "#ffc890",
                  "highAmt": 0.04
                }
              },
              "weather": {
                "clouds": {
                  "sat": 0.3,
                  "mul": [
                    0.22,
                    0.26,
                    0.4
                  ]
                },
                "ov": {
                  "sat": 0.4,
                  "mul": [
                    0.45,
                    0.5,
                    0.7
                  ]
                },
                "fog": {
                  "sat": 0.3,
                  "mul": [
                    0.4,
                    0.45,
                    0.65
                  ]
                },
                "sun": {
                  "sat": 0.3,
                  "mul": 0.6
                },
                "rain": {
                  "sat": 0.6,
                  "mul": 0.8
                },
                "hemiSky": "#5a6680",
                "hemiGround": "#2a2c36"
              },
              "windows": {
                "glow": 1.2,
                "lit": 1.15
              },
              "lamps": 1.2,
              "landmarkNight": 0.85,
              "enemySight": 0.8
            },
            "night": {
              "sky": {
                "zenith": "#050a18",
                "horizon": "#2a2636",
                "ground": "#0c0e14",
                "sunColor": "#a9bce6",
                "sunDir": [
                  0.35,
                  0.75,
                  0.55
                ],
                "sunIntensity": 0.1,
                "disc": false,
                "moon": true,
                "background": "sky/night_bg.jpg",
                "env": "sky/night_env.jpg"
              },
              "hemi": {
                "mul": 0.34
              },
              "fog": {
                "mul": 0.75,
                "color": "#302832"
              },
              "exposure": 1.45,
              "grade": {
                "outdoor": {
                  "saturation": 0.94,
                  "lift": 0.03,
                  "liftColor": "#0a1430",
                  "shadowTint": "#101c3a",
                  "shadowAmt": 0.12,
                  "highTint": "#ffcf99",
                  "highAmt": 0.05,
                  "vignette": 0.36
                }
              },
              "weather": {
                "clouds": {
                  "sat": 0.2,
                  "mul": [
                    0.05,
                    0.05,
                    0.07
                  ]
                },
                "ov": {
                  "sat": 0.4,
                  "mul": [
                    0.5,
                    0.48,
                    0.55
                  ]
                },
                "fog": {
                  "sat": 0.6,
                  "mul": [
                    0.28,
                    0.25,
                    0.3
                  ]
                },
                "sun": {
                  "sat": 0.3,
                  "mul": 0.3
                },
                "rain": {
                  "sat": 0.6,
                  "mul": 0.7
                },
                "hemiSky": "#7a8090",
                "hemiGround": "#3a3840"
              },
              "windows": {
                "glow": 1.4,
                "lit": 1.3
              },
              "lamps": 1.6,
              "landmarkNight": 1,
              "enemySight": 0.6
            }
          }
        },
        "weather": {
          "clouds": true,
          "cloudDetail": true,
          "textureMax": null,
          "rain": true,
          "splashes": true,
          "puddles": true,
          "drops": 3000,
          "dropBox": [
            26,
            18,
            26
          ],
          "dropLen": 0.75,
          "dropWidth": 0.035,
          "dropMinPx": 1.5,
          "dropMaxPx": 4,
          "dropOpacity": [
            0.3,
            0.6
          ],
          "nearFade": 0.6,
          "cabinClear": {
            "heli": 3,
            "jet": 4.5,
            "vtol": 4.5,
            "car": 1.6,
            "ship": 4.5
          },
          "streakMaxSpeed": 60,
          "splashMax": 64,
          "splashPerSec": 120,
          "splashRadius": 12,
          "splashPool": 48,
          "splashPoolQueriesPerTick": 8,
          "velJump": 5,
          "velJumpSpeed": 450,
          "velMax": 120,
          "dropsMin": 0.3,
          "streakCrop": 0.14,
          "cover": true,
          "coverCells": 32,
          "coverCell": 1,
          "coverQueries": 48,
          "coverBurst": 384,
          "coverChecks": 384,
          "lightningBolt": true,
          "mobile": {
            "cloudDetail": false,
            "textureMax": 512,
            "drops": 2400,
            "dropOpacity": [
              0.35,
              0.7
            ],
            "splashMax": 48,
            "splashPerSec": 90,
            "splashPool": 24
          }
        },
        "city": {
          "look": {
            "_note": "cinematic-interiors V2 X1 (farlook.js): far-city window colours (weights in %, groundOnly = indices only on the ground floor), lit share per building (offices = styles 3-6 in blocks of blockFloors floors x blockBays bays, homes = brick styles 1-2 scattered; far windows = average colour + farVar of the 4x3 block colour), roof palette, per-building tint (value +-, hue +- degrees, saturation x). enabled false or ?look=0 = off",
            "windows": {
              "colors": [
                "#ffb46b",
                "#ffd29a",
                "#fff1d8",
                "#e6f0ff",
                "#6fe3d8",
                "#ff6fb0"
              ],
              "weights": [
                42,
                27,
                18,
                10,
                1.5,
                1.5
              ],
              "groundOnly": [
                5
              ],
              "litOffice": [
                0.55,
                0.8
              ],
              "litHome": [
                0.25,
                0.45
              ],
              "blockFloors": 3,
              "blockBays": 8,
              "farVar": 0.3
            },
            "roofs": {
              "colors": [
                "#5b5650",
                "#3f4a52",
                "#6a5f4f",
                "#4c4844"
              ],
              "green": "#7f8a7a",
              "greenShare": 0.05,
              "key": "#4c4844"
            },
            "tint": {
              "value": 0.08,
              "hue": 6,
              "sat": 1.15
            }
          },
          "underground": {
            "_note": "nyc-complete NC6 (world.js _surfaceHide): while the camera is in a station void, surface chunks / ground stay drawn only within openingRange m of a stair opening (and above the pit floor - openingDepth m); LOD, skyline, props and landmarks are hidden. Near an opening (surface level 1) the street chunk meshes, vehicles and enemies are drawn only inside the view frustum through the opening (the pit rectangle at the sidewalk top widened by portalPad m; no culling while the camera is within portalLip m of the sidewalk top); deep (level 2) surface vehicles / enemies are not drawn. No shadow-map pass while underground (the sun is 0 there)",
            "openingRange": 14,
            "openingDepth": 4,
            "portalPad": 0.5,
            "portalLip": 0.3
          },
          "fullIn": 100,
          "fullOut": 124,
          "lodIn": 640,
          "lodOut": 760,
          "interiorDist": 45,
          "interiors": {
            "detailDist": 15,
            "nDist": 12,
            "refillMove": 2,
            "maxBoxes": 6000,
            "maxPanels": 600,
            "indoorLift": 0.18,
            "panelColor": "#fff3dc",
            "panelIntensity": 1.6
          },
          "doors": {
            "maxDoors": 400,
            "glassColor": "#9fc4d6",
            "glassOpacity": 0.32,
            "frameColor": "#3a4048",
            "woodColor": "#6b4a32",
            "metalColor": "#6d747c"
          },
          "propDist": 80,
          "treeDist": 70,
          "treeCards": true,
          "treeCardTint": 1.3,
          "cityKit": {
            "enabled": true,
            "classes": [
              "tablet",
              "tabletPro",
              "desktop"
            ],
            "dist": 75,
            "maxTris": 140000,
            "ms": 1.5,
            "phone": {
              "dist": 55,
              "maxTris": 70000,
              "ms": 1
            },
            "palette": [
              "#8e2b26",
              "#2f5a3a",
              "#25425f",
              "#7a5a2a",
              "#5a2f4f",
              "#3f3f3f"
            ]
          },
          "propEmissive": 2,
          "propCull": true,
          "propCullWiden": 6,
          "propCullTurn": 3,
          "propCullMove": 0.5,
          "propCullFov": 0.5,
          "propShadowMax": 40,
          "propNoShadow": [
            "hydrant",
            "trash_can",
            "bench",
            "planter",
            "mailbox",
            "jersey_barrier",
            "crate"
          ],
          "windowEmissive": 1.4,
          "farWindowGlow": 1.25,
          "farWindowLit": 1,
          "facade": {
            "_note": "buildings-hq B1: v2 の街（manhattan）の外壁の窓をシェーダーで描く（www/js/facade.js）。enabled false / ?facade=0 = 今まで通りのテクスチャの壁。lit = 灯りの割合の倍率（時間帯の farWindowLit にも掛かる）、parapet = 屋上の手前の窓を描かない帯 m、plainGids / plainCls = 窓なしにする gid（24 自由の女神と砦）とクラス、minEdge = これより短い辺は窓なし m",
            "enabled": true,
            "lit": 1,
            "parapet": 0.9,
            "plainGids": [
              24
            ],
            "plainCls": [
              "roof",
              "shed"
            ],
            "minEdge": 1.2,
            "monumentArea": 30,
            "monumentSlender": 2.5,
            "_noteB3": "B3: midtown（v1 の箱）も同じ材質。litCurve = 時間帯の farWindowLit（夕方 1・夜 1.3）→ 灯りの倍率（夕方 0.75 = 25〜35 %）、glowCurve → 窓の発光の倍率（夜 1）、litRun = 一緒に点く事務所の間の数、litFloor = 階ぜんぶ点く割合、litSingle = 1 つだけの窓。midtown.bay.default は citykit のれんがの窓の格子（3 m）と同じにする（エアコンが窓に載る）",
            "litCurve": [
              [
                0,
                0
              ],
              [
                0.15,
                0.06
              ],
              [
                0.6,
                0.35
              ],
              [
                1,
                0.75
              ],
              [
                1.15,
                1
              ],
              [
                1.3,
                1.3
              ],
              [
                2,
                2
              ]
            ],
            "glowCurve": [
              [
                0,
                0.6
              ],
              [
                1,
                0.75
              ],
              [
                1.3,
                1
              ],
              [
                2,
                1
              ]
            ],
            "litRun": [
              2,
              7
            ],
            "litFloor": 0.05,
            "litSingle": 0.04,
            "litGap": 0.14,
            "litEdge": 0.45,
            "litWhole": 0.25,
            "litBoost": 1.4,
            "_noteB31": "B3.1: 9 間の升ごとに 1 つ（9 間 = litWhole）か 2 つ（litRun の間）の事務所。litGap = 点いた事務所の中の消えた窓、litEdge = 事務所の端の窓が消える割合、litBoost = 事務所の点く割合の倍率（消えた窓の分）。litFloor × 灯り = 階ぜんぶ",
            "midtown": {
              "bay": {
                "default": 3,
                "glass": 1.5,
                "postwar": 1.5,
                "artdeco": 1.5
              },
              "decoHeight": 80,
              "decoRules": [
                "midtown_core"
              ],
              "decoShare": 0.6,
              "brownstoneRules": [
                "residential_east",
                "residential_west"
              ],
              "brownstoneShare": 0.4,
              "plainKinds": [
                "canopy"
              ],
              "dirt": [
                0.05,
                0.85
              ],
              "palettes": {
                "brick_brown": [
                  "#6a4a36",
                  "#5e3f2f",
                  "#74503a",
                  "#6d4636",
                  "#583c2e",
                  "#7d5843"
                ],
                "brick_red": [
                  "#8e3d2c",
                  "#7d3a2b",
                  "#9a4a34",
                  "#84402f",
                  "#a0563c",
                  "#733428"
                ],
                "office_stone": [
                  "#a39a8c",
                  "#b2a894",
                  "#958e82",
                  "#aca394",
                  "#9b9384"
                ],
                "limestone": [
                  "#c9bfa8",
                  "#d2c8b0",
                  "#bfb59e",
                  "#cbbfa2",
                  "#c4bba9"
                ],
                "concrete": [
                  "#9b968d",
                  "#a5a198",
                  "#8e8b85",
                  "#aaa49a",
                  "#93908a"
                ],
                "glass_tower": [
                  "#4c5d6c",
                  "#3f5566",
                  "#465a62",
                  "#52626e",
                  "#3c4f5e"
                ]
              }
            }
          },
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
          "navRemovePerFrame": 3,
          "prefetchRadius": 2,
          "warmMaterials": true,
          "shadowCasters": true,
          "shadowRadius": 60,
          "shadowDistance": 500,
          "shadowFar": 1100,
          "hemiIntensity": 1,
          "landSpecular": 0.2,
          "wetLandCell": 256,
          "landmarks": true,
          "props": true,
          "water": true,
          "billboards": true,
          "landmarkFar": 600,
          "timesSquare": {
            "enabled": true,
            "level": "manhattan",
            "activate": 1600,
            "axisDist": 60,
            "faceDot": 0.55,
            "minEdge": 5,
            "minTop": 12,
            "bottom": 4.6,
            "hMin": 18,
            "hMax": 40,
            "gap": 0.7,
            "segMax": 22,
            "outset": 0.3,
            "adShare": 0.65,
            "tickerShare": 0.45,
            "tickerH": 1.4,
            "bladeShare": 0.5,
            "bladeW": 1.5,
            "bladeD": 1.6,
            "bladeHMin": 9,
            "bladeHMax": 16,
            "oneTsGids": [
              30226
            ],
            "oneTsBottom": 9,
            "oneTsTop": 0.93,
            "oneTsBlock": 13,
            "kioskMaxH": 11,
            "pylonH": 7,
            "kioskMaxArea": 150,
            "kioskAxisDist": 30,
            "recruitGids": [
              29844
            ],
            "kioskPad": 0.06,
            "tktsSteps": 16,
            "waitFrames": 90,
            "texMax": 512,
            "bright": 1.3,
            "amb": 0.05,
            "todBright": {
              "dusk": 1,
              "golden": 0.9,
              "noon": 0.7,
              "haze": 0.85,
              "blue": 1.1,
              "night": 1.15
            }
          },
          "landmarkNight": {
            "night": 0.55,
            "windows": [
              0.15,
              1.6
            ],
            "glow": [
              0.6,
              1.4
            ],
            "far": [
              0.5,
              1.4
            ],
            "matMul": {
              "sh_glow": 0.6
            },
            "beacons": {
              "color": "#ff2a1a",
              "size": 3.2,
              "minPx": 2.5,
              "maxPx": 40,
              "period": 1.5,
              "on": 0.4,
              "from": 0.2,
              "intensity": 2.2,
              "points": {
                "skyhigh": [
                  [
                    27.1,
                    271.9,
                    18.3
                  ],
                  [
                    27.1,
                    271.9,
                    -18.3
                  ],
                  [
                    -27.1,
                    271.9,
                    18.3
                  ],
                  [
                    -27.1,
                    271.9,
                    -18.3
                  ],
                  [
                    21.4,
                    126.4,
                    18.4
                  ],
                  [
                    -21.4,
                    126.4,
                    18.4
                  ],
                  [
                    21.4,
                    126.4,
                    -18.4
                  ],
                  [
                    -21.4,
                    126.4,
                    -18.4
                  ],
                  [
                    26.4,
                    126.4,
                    13.4
                  ],
                  [
                    26.4,
                    126.4,
                    -13.4
                  ],
                  [
                    -26.4,
                    126.4,
                    13.4
                  ],
                  [
                    -26.4,
                    126.4,
                    -13.4
                  ]
                ]
              }
            }
          },
          "tileCache": 32,
          "tilePrefetchRadius": 1,
          "tileFlightLead": 2,
          "tileConcurrency": 2,
          "skylineMinH": 40,
          "shoreRes": 1024,
          "groundGroup": 0,
          "textureMax": {
            "normal": 1024,
            "orm": 1024,
            "emissive": 1024,
            "interior": 1024,
            "glbDetail": 1024
          },
          "bake": {
            "enabled": true,
            "download": true,
            "packs": false,
            "worker": true,
            "workerTimeoutMs": 4000,
            "workerCallTimeoutMs": 10000,
            "storageTimeoutMs": 15000,
            "startWaitMs": 2000,
            "waitFrames": 6,
            "waitMs": 100,
            "prefetchLod": true,
            "prefetchMargin": 150,
            "readyMax": 16,
            "pauseAboveSpeed": 60,
            "playGapMs": 1500,
            "calmFrameMs": 22,
            "calmMaxWaitMs": 60000,
            "fetchMax": 2
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
            "interiors": {
              "detailDist": 10,
              "nDist": 8,
              "refillMove": 2,
              "maxBoxes": 4000,
              "maxPanels": 300,
              "indoorLift": 0.18,
              "panelColor": "#fff3dc",
              "panelIntensity": 1.6
            },
            "cacheChunks": 40,
            "prefetchRadius": 1,
            "navMsWalk": 3,
            "propsGlbCrate": false,
            "tileCache": 20,
            "shoreRes": 512,
            "textureMax": {
              "albedo": 1024,
              "normal": 512,
              "orm": 512,
              "emissive": 512,
              "interior": 512,
              "glb": 1024,
              "glbDetail": 512
            },
            "bake": {
              "calmFrameMs": 36
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
        "lazyDecode": [
          "rain_light",
          "rain_heavy",
          "rain_roof",
          "wind_gust",
          "thunder_*"
        ],
        "decodeGroups": {
          "knife": [
            "knife_*"
          ],
          "spray": [
            "rotor_spray*",
            "spray_*"
          ],
          "destruct": [
            "debris_*",
            "glass_break*",
            "crumble_*",
            "breach_*",
            "blast_*",
            "collapse_*"
          ],
          "crash": [
            "fire_ignite",
            "fire_loop",
            "secondary_pop",
            "steam_hiss"
          ],
          "aa": [
            "aa_fire"
          ],
          "arenaBed": [
            "ambience_dusk"
          ],
          "cityMusic": [
            "music_city"
          ],
          "subway": [
            "train_*",
            "tunnel_rumble",
            "tram_hum"
          ],
          "smoke": [
            "smoke_hiss"
          ]
        },
        "weather": {
          "indoor": 0.3,
          "cabin": 0.25,
          "fast": 0.3,
          "roofInside": 1,
          "windGust": 0.9,
          "gustFromWind": 7,
          "gustFullWind": 12,
          "gustCabin": 0.4,
          "gustStateWind": 10,
          "lightFull": 0.55,
          "lightCurve": 1.5,
          "heavyFrom": 0.6,
          "releaseSlots": 2,
          "roofReleaseSec": 10,
          "hz": 4,
          "startAbove": 0.02,
          "stopBelow": 0.01,
          "stopAfter": 5,
          "fadeIn": 1.5,
          "fadeOut": 1.5,
          "thunderNear": 1,
          "thunderFar": 0.45,
          "thunderIndoor": 0.55,
          "thunderCabin": 0.6,
          "thunderMax": 2,
          "thunderHz": 10,
          "thunderFade": 0.6,
          "thunderEndPad": 0.25,
          "thunderDefaultSec": 12
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
            "max": 2,
            "interval": 0.1
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
          "lock_tone": {
            "max": 1
          },
          "lock_solid": {
            "max": 1
          },
          "rwr_warning": {
            "max": 1
          },
          "explosion_large": {
            "max": 3,
            "interval": 0.04
          },
          "explosion_far": {
            "max": 2,
            "interval": 0.1
          },
          "secondary_pop": {
            "max": 3,
            "interval": 0.15
          },
          "debris_metal": {
            "max": 3
          },
          "fire_ignite": {
            "max": 2
          },
          "thunder_*": {
            "max": 2,
            "interval": 1.5
          }
        }
      },
      "online": {
        "server": "",
        "cityLevel": "midtown",
        "cityLevels": [
          "midtown",
          "manhattan"
        ],
        "levels": {
          "manhattan": {
            "server": ""
          }
        },
        "loadTimeout": 60,
        "maxPlayers": 8,
        "respawnDelay": 3,
        "city": {
          "requireGen": true,
          "stations": true,
          "_stations": "nyc-complete NC8: subway stations online (v2 levels with plan.underground). The client (game.js _railOpts) and the server (server/cityworld.js CityWorld.stationsOn: online.levels.<id>.city.stations first) read the same key; false = both without stations (no voids / pits / station loot on either side). The server reads its bundled game.json: flip it only together with a server deploy",
          "interiors": true,
          "boats": false,
          "ships": false,
          "areaRadius": 450,
          "rotateMinutes": 15,
          "rotateWarning": 30,
          "outsideDps": 8,
          "interest": 600,
          "interestAir": 1500,
          "fireRange": 700,
          "liftReach": 1,
          "liftSide": 0.3,
          "liftCooldown": 2.5,
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
      "missiles": {
        "maxStep": 0.0167,
        "defaultType": "aim9x",
        "select": "auto",
        "pursuitCos": 0.94,
        "pursuitGate": 0.5,
        "pursuitGain": 2,
        "tgoClose": 50,
        "tgoSpeed": 100,
        "flareFuseK": 0.6,
        "flareGravity": 0.35,
        "flareDrag": 0.8,
        "decoyMinTime": 1,
        "caps": {
          "active": 24,
          "flares": 48,
          "audioLoops": 3,
          "mobileActive": 12,
          "mobileFlares": 24,
          "mobileAudioLoops": 2,
          "server": 16
        },
        "trail": {
          "every": 0.04,
          "width": 0.9,
          "life": 2.2
        },
        "types": {
          "aim9x": {
            "seeker": "ir",
            "proto": "proj_aim9x",
            "glb": "ordnance",
            "length": 3.06,
            "maxRange": 1800,
            "speed": 430,
            "accel": 260,
            "motorTime": 2.6,
            "coastDrag": 45,
            "turnG": 60,
            "navN": 4,
            "gimbal": 75,
            "fuse": 8,
            "damage": 600,
            "blastRadius": 14,
            "life": 8,
            "decoyChance": 0.8,
            "decoyRange": 2500,
            "decoyRolls": 2
          },
          "aim120": {
            "seeker": "radar",
            "proto": "proj_aim120",
            "glb": null,
            "length": 3.66,
            "maxRange": 4000,
            "speed": 600,
            "accel": 210,
            "motorTime": 4.5,
            "coastDrag": 30,
            "turnG": 35,
            "navN": 3,
            "gimbal": 60,
            "fuse": 10,
            "damage": 700,
            "blastRadius": 16,
            "life": 14,
            "decoyChance": 0.25,
            "decoyRange": 2500,
            "decoyRolls": 1
          },
          "manpads": {
            "seeker": "ir",
            "proto": "proj_aa",
            "glb": "projectiles",
            "fins": "fins_aa",
            "length": 1.42,
            "speed": 520,
            "accel": 300,
            "motorTime": 3,
            "coastDrag": 50,
            "turnG": 30,
            "navN": 3,
            "gimbal": 60,
            "fuse": 6,
            "damage": 420,
            "blastRadius": 8,
            "life": 9,
            "decoyChance": 0.75,
            "decoyRange": 1500,
            "decoyRolls": 2
          },
          "gbu16": {
            "seeker": "laser",
            "proto": "proj_gbu",
            "glb": "ordnance",
            "length": 3.7,
            "glide": true,
            "maxRange": 3000,
            "speed": 0,
            "accel": 0,
            "motorTime": 0,
            "coastDrag": 0,
            "drag": 0.00011,
            "glideRefSpeed": 200,
            "minSpeed": 40,
            "ejectSpeed": 2,
            "dropTime": 0.6,
            "armTime": 1.2,
            "turnG": 6,
            "navN": 3,
            "gimbal": 90,
            "fuse": 4,
            "loftFrom": 0,
            "loftK": 0,
            "loftMax": 0,
            "liftRate": 0,
            "damage": 1400,
            "blastRadius": 30,
            "life": 45,
            "decoyChance": 0,
            "decoyRange": 0,
            "decoyRolls": 0,
            "release": {
              "minAgl": 200,
              "maxAgl": 650,
              "maxDive": 35,
              "glideRatio": 4
            },
            "ccipEvery": 0.1,
            "ccipStep": 0.5
          }
        }
      },
      "puffs": {
        "textureMax": 1024,
        "mobileTextureMax": 512,
        "sortEvery": 0.1,
        "nearFade": {
          "smoke": 2,
          "explosion": 2,
          "fire": 6,
          "ember": 6
        },
        "caps": {
          "smoke": 160,
          "explosion": 48,
          "fire": 192,
          "ember": 96
        },
        "reserveMax": {
          "smoke": 0.7
        },
        "trails": {
          "slots": 32,
          "points": 24
        },
        "mobile": {
          "caps": {
            "smoke": 96,
            "explosion": 32,
            "fire": 96,
            "ember": 48
          },
          "trails": {
            "slots": 16,
            "points": 16
          }
        }
      },
      "fire": {
        "wreckSec": {
          "jet": 75,
          "heli": 60,
          "car": 45,
          "vtol": 80
        },
        "dps": 12,
        "tick": 0.25,
        "vehicleDps": 25,
        "chainMax": 2,
        "airAgl": 3,
        "roofMin": 4,
        "patch": {
          "jet": {
            "n": 5,
            "spacing": 9,
            "r0": 3,
            "r1": 6,
            "grow": 6,
            "life": [
              35,
              55
            ]
          },
          "heli": {
            "n": 3,
            "spacing": 6,
            "r0": 2.5,
            "r1": 5,
            "grow": 5,
            "life": [
              30,
              45
            ]
          },
          "car": {
            "n": 1,
            "spacing": 0,
            "r0": 2,
            "r1": 3.5,
            "grow": 4,
            "life": [
              25,
              40
            ]
          },
          "vtol": {
            "n": 6,
            "spacing": 10,
            "r0": 3.5,
            "r1": 7,
            "grow": 6,
            "life": [
              40,
              60
            ]
          },
          "trailEvery": 14,
          "keepOut": 6,
          "shrink": 8,
          "maxStep": 3,
          "jitter": 2.5,
          "dy": 2.5
        },
        "facade": {
          "minBoxTop": 30,
          "sec": 50,
          "flames": 4,
          "edge": 4,
          "edgeDrop": 2
        },
        "secondary": {
          "n": [
            1,
            3
          ],
          "perKind": {
            "heli": [
              1,
              2
            ],
            "car": [
              0,
              1
            ],
            "vtol": [
              2,
              4
            ]
          },
          "delay": [
            2,
            9
          ],
          "radius": 5,
          "damage": 40,
          "spread": 5
        },
        "slide": {
          "minSpeed": 55,
          "maxAngle": 18,
          "decel": 22,
          "maxSec": 4.5,
          "stopSpeed": 8,
          "spin": 0.5,
          "roll": 0.06,
          "rollHz": 1.4,
          "sink": 0.9,
          "stepUp": 1,
          "drop": 2.5,
          "sparkEvery": 0.05,
          "sparks": 3,
          "sparkSpeed": [
            4,
            10
          ],
          "scrapeEvery": 0.5,
          "scrapeVolume": 0.9,
          "trail": [
            0.7,
            0.6,
            0.6
          ],
          "maxTrail": 16
        },
        "causeSec": 30,
        "blast": {
          "jet": "jetCrash",
          "heli": "heliCrash",
          "car": "carCrash",
          "missile": "aim120",
          "vtol": "jetCrash"
        },
        "debris": {
          "jet": [
            10,
            16
          ],
          "heli": [
            8,
            12
          ],
          "car": [
            4,
            6
          ],
          "vtol": [
            12,
            18
          ]
        },
        "scorch": {
          "jet": 9,
          "heli": 6,
          "car": 3.5,
          "vtol": 12,
          "sec": 120
        },
        "steamSec": 6,
        "tail": 10,
        "loopRange": 250,
        "steamRange": 200,
        "hurtEvery": 0.9,
        "lod": {
          "near": 150,
          "mid": 600,
          "far": 2500,
          "nearMax": 3
        },
        "column": {
          "height": 220,
          "every": 0.5,
          "size": [
            18,
            60
          ],
          "fogScale": 0.35,
          "farScale": 2.2,
          "life": 16
        },
        "patchFx": {
          "near": {
            "rate": 4,
            "rateK": 1.6,
            "ember": 1.5,
            "smoke": 0.4
          },
          "mid": {
            "rate": 1.2,
            "rateK": 0.5
          },
          "life": [
            0.7,
            1.1
          ],
          "size": [
            1.3,
            2.3
          ],
          "rise": [
            1.4,
            2.2
          ],
          "share": 0.5
        },
        "facadeFx": {
          "spacing": 3,
          "spread": 3,
          "near": 0.1,
          "mid": 0.25,
          "size": [
            3,
            5
          ],
          "out": 0.9
        },
        "debrisFx": {
          "gravity": 14,
          "restitution": 0.35,
          "friction": 0.55,
          "maxBounces": 3,
          "life": [
            9,
            15
          ],
          "fade": 1.5,
          "glowSec": [
            1.5,
            3.5
          ],
          "glow": [
            1.8,
            0.6,
            0.15
          ],
          "color": "#34322f",
          "soundRange": 120,
          "soundEvery": 0.12,
          "soundSpeed": 4,
          "airShare": 0.6,
          "landShare": 0.5,
          "kits": {
            "jet": {
              "size": [
                0.5,
                1.4
              ],
              "speed": [
                8,
                22
              ],
              "up": [
                6,
                16
              ],
              "inherit": 0.35,
              "spin": 9
            },
            "heli": {
              "size": [
                0.4,
                1.1
              ],
              "speed": [
                6,
                16
              ],
              "up": [
                5,
                13
              ],
              "inherit": 0.35,
              "spin": 9
            },
            "car": {
              "size": [
                0.3,
                0.8
              ],
              "speed": [
                5,
                12
              ],
              "up": [
                5,
                11
              ],
              "inherit": 0.3,
              "spin": 8
            },
            "vtol": {
              "size": [
                0.6,
                1.6
              ],
              "speed": [
                8,
                20
              ],
              "up": [
                6,
                15
              ],
              "inherit": 0.35,
              "spin": 8
            },
            "secondary": {
              "size": [
                0.2,
                0.5
              ],
              "speed": [
                4,
                10
              ],
              "up": [
                5,
                10
              ],
              "inherit": 0,
              "spin": 10,
              "n": [
                2,
                4
              ],
              "life": [
                5,
                8
              ]
            }
          },
          "node": {
            "speed": [
              4,
              10
            ],
            "up": [
              5,
              11
            ],
            "inherit": 0.5,
            "spin": 5
          }
        },
        "secondaryFx": {
          "size": 1.5,
          "refDistance": 15,
          "maxDistance": 600
        },
        "flashLight": true,
        "shake": 120,
        "farFrom": 300,
        "caps": {
          "fires": 8,
          "patches": 24,
          "debris": 48,
          "scorch": 16,
          "loops": 3
        },
        "mobile": {
          "flashLight": false,
          "caps": {
            "fires": 5,
            "patches": 16,
            "debris": 24,
            "scorch": 8,
            "loops": 2
          }
        }
      },
      "explosives": {
        "farFrom": 300,
        "blasts": {
          "story_strike": {
            "radius": 7,
            "edge": 0.6,
            "playerEdge": 0.7,
            "chest": 1,
            "centerDist": true,
            "damage": 260,
            "vehicle": 1100,
            "player": 0.4,
            "prop": 1,
            "vs": {
              "apc": 1,
              "default": 1
            },
            "shakeRange": 120,
            "fx": 3,
            "struct": {
              "radius": 2,
              "damage": 300
            }
          },
          "vtol_gun": {
            "radius": 4.5,
            "edge": 0.5,
            "playerEdge": 0.7,
            "chest": 1,
            "centerDist": true,
            "damage": 120,
            "vehicle": 1.2,
            "player": 0.6,
            "prop": 1,
            "vs": {
              "apc": 0.8,
              "default": 1
            },
            "shakeRange": 70,
            "fx": 2.2,
            "struct": {
              "radius": 2,
              "damage": 300
            }
          },
          "aim9x": {
            "radius": 14,
            "edge": 0.6,
            "chest": 1,
            "centerDist": true,
            "damage": 600,
            "vehicle": 600,
            "player": 0.3,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 120,
            "fx": 3,
            "structMul": 6
          },
          "aim120": {
            "radius": 16,
            "edge": 0.6,
            "chest": 1,
            "centerDist": true,
            "damage": 700,
            "vehicle": 700,
            "player": 0.3,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 120,
            "fx": 3.5,
            "structMul": 6
          },
          "manpads": {
            "radius": 8,
            "edge": 0.6,
            "chest": 1,
            "centerDist": true,
            "damage": 420,
            "vehicle": 420,
            "player": 0.3,
            "prop": 0.3,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 60,
            "fx": 3,
            "structMul": 6
          },
          "gbu16": {
            "radius": 30,
            "edge": 0.6,
            "chest": 1,
            "centerDist": true,
            "damage": 1400,
            "vehicle": 1400,
            "player": 0.3,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeGain": 1.1,
            "splash": 5,
            "shakeRange": 250,
            "fx": 7,
            "struct": {
              "radius": 18,
              "damage": 1200
            }
          },
          "jetCrash": {
            "radius": 18,
            "edge": 0.6,
            "playerEdge": 0.7,
            "chest": 1,
            "centerDist": true,
            "seat": "occupant",
            "damage": 400,
            "vehicle": 0,
            "player": 1,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 120,
            "fx": 6
          },
          "heliCrash": {
            "radius": 10,
            "edge": 0.6,
            "playerEdge": 0.7,
            "chest": 1,
            "centerDist": true,
            "seat": "occupant",
            "damage": 220,
            "vehicle": 0,
            "player": 1,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 100,
            "fx": 4.5
          },
          "carCrash": {
            "radius": 7,
            "edge": 0.6,
            "playerEdge": 0.7,
            "chest": 1,
            "centerDist": true,
            "seat": "occupant",
            "damage": 160,
            "vehicle": 0,
            "player": 1,
            "prop": 1,
            "vs": {
              "apc": 0.35,
              "heli": 0.6,
              "jet": 0.5,
              "vtol": 0.5,
              "default": 1
            },
            "shakeRange": 60,
            "fx": 3.5
          },
          "secondary": {
            "radius": 5,
            "core": 1,
            "damage": 40,
            "coreDamage": 60,
            "falloff": 1.2,
            "vehicle": 40,
            "player": 1,
            "prop": 0.5,
            "vs": {
              "default": 1
            },
            "shakeRange": 40,
            "fx": 1.5
          }
        }
      },
      "boats": {
        "enterRise": 2.6,
        "enterDistance": 3.5,
        "boardReach": 3.5,
        "boardRise": 4.6,
        "exitDrop": 1,
        "runoverSpeed": 3,
        "runoverDamage": 8,
        "runoverMax": 80,
        "lidDist": 60,
        "shoreGridCell": 16,
        "lazyRetry": 30,
        "parkedShadowsMobile": false,
        "sleepTime": 2,
        "parkedBob": 0.6,
        "enterHint": 900,
        "chaseRecenterDelay": 1.5,
        "chaseRecenterRate": 1.5,
        "chaseRecenterSpeed": 1.5,
        "chasePitch": -0.12,
        "chaseLookEps": 0.0005,
        "blastScale": 1,
        "blastEdge": 0.6
      },
      "ships": {
        "enabled": true,
        "dataVersion": 1,
        "attachMargin": 0.6,
        "detachDelay": 0.2,
        "carryMaxDyaw": 0.2,
        "nearRange": 6,
        "maxNear": 2,
        "pushDamageSpeed": 4,
        "pushDamage": 6,
        "swimSlide": 3,
        "swimSlideDot": 0.6,
        "hornRange": 900,
        "maxCarriedVehicles": 3,
        "carriedHideDist": 900,
        "wakeEmitDist": 600,
        "wakeMaxEmitters": 6,
        "clockOffsetSpan": 100000,
        "audioRange": 250,
        "audioMax": 2,
        "types": {
          "ferry_catamaran": {
            "accel": 0.5,
            "decel": 0.6,
            "cruise": 11,
            "turnRadius": 70,
            "horn": "ship_horn_deep",
            "engine": 0.6,
            "deckMat": "metal",
            "wake": 3.2
          },
          "sightseeing_boat": {
            "accel": 0.3,
            "decel": 0.4,
            "cruise": 6,
            "turnRadius": 90,
            "horn": "ship_horn_deep",
            "engine": 0.55,
            "deckMat": "wood",
            "wake": 4
          },
          "tugboat_push": {
            "accel": 0.15,
            "decel": 0.2,
            "cruise": 3.5,
            "turnRadius": 160,
            "horn": "boat_horn",
            "engine": 0.5,
            "convoy": "barge",
            "deckMat": "metal",
            "wake": 3.5
          },
          "barge": {
            "deckMat": "metal",
            "engine": 0,
            "wake": 0
          },
          "sailboat": {
            "accel": 0.2,
            "decel": 0.2,
            "cruise": 3,
            "turnRadius": 40,
            "heel": 9,
            "engine": 0,
            "deckMat": "wood",
            "wake": 1.2
          },
          "ferry_orange": {
            "accel": 0.25,
            "decel": 0.3,
            "cruise": 8,
            "turnRadius": 150,
            "doubleEnded": true,
            "horn": "ship_horn_deep",
            "engine": 0.65,
            "deckMat": "metal",
            "wake": 6
          },
          "cruise_ship": {
            "static": true,
            "deckMat": "wood"
          }
        },
        "interiors": {
          "enabled": true,
          "drawDist": 70,
          "types": {
            "sightseeing_boat": {
              "houses": [
                {
                  "box": "deck2_house",
                  "wall": 0.25,
                  "slab": 0.25,
                  "floor0": 0,
                  "liner": "plaster_interior",
                  "ceiling": "plaster_interior",
                  "floorMat": "wood_floor",
                  "deckMat": "wood",
                  "openPlate": true,
                  "openings": [
                    [
                      0,
                      "z0",
                      -1,
                      1,
                      2.2,
                      4.3
                    ],
                    [
                      0,
                      "z1",
                      -1,
                      1,
                      2.2,
                      4.3
                    ]
                  ],
                  "windows": [
                    [
                      0,
                      "x0",
                      -15,
                      12,
                      3.1,
                      4.3
                    ],
                    [
                      0,
                      "x1",
                      -15,
                      12,
                      3.1,
                      4.3
                    ]
                  ],
                  "lights": [
                    [
                      -0.3,
                      -16,
                      0.3,
                      13,
                      4.58,
                      4.63
                    ]
                  ],
                  "rows": [
                    {
                      "xs": [
                        [
                          -3.95,
                          -1.6
                        ],
                        [
                          1.6,
                          3.95
                        ]
                      ],
                      "z0": -14,
                      "z1": 11,
                      "step": 1.8,
                      "d": 0.5,
                      "h": 0.45,
                      "mat": "crate"
                    }
                  ]
                }
              ]
            },
            "ferry_catamaran": {
              "houses": [
                {
                  "box": "cabin",
                  "wall": 0.25,
                  "slab": 0.25,
                  "floor0": 0,
                  "liner": "plaster_interior",
                  "ceiling": "plaster_interior",
                  "floorMat": "terrazzo",
                  "deckMat": "metal",
                  "openPlate": true,
                  "openings": [
                    [
                      0,
                      "z0",
                      -0.9,
                      0.9,
                      2,
                      4.2
                    ],
                    [
                      0,
                      "z1",
                      -0.9,
                      0.9,
                      2,
                      4.2
                    ]
                  ],
                  "windows": [
                    [
                      0,
                      "x0",
                      -7,
                      6.5,
                      3,
                      4.1
                    ],
                    [
                      0,
                      "x1",
                      -7,
                      6.5,
                      3,
                      4.1
                    ]
                  ],
                  "lights": [
                    [
                      -0.3,
                      -7.5,
                      0.3,
                      7,
                      4.48,
                      4.53
                    ]
                  ],
                  "rows": [
                    {
                      "xs": [
                        [
                          -3.5,
                          -1.3
                        ],
                        [
                          1.3,
                          3.5
                        ]
                      ],
                      "z0": -6.6,
                      "z1": 5.4,
                      "step": 1.8,
                      "d": 0.5,
                      "h": 0.45,
                      "mat": "crate"
                    }
                  ]
                }
              ]
            }
          }
        }
      },
      "waves": {
        "amp": 0.12,
        "comps": [
          [
            22,
            35,
            1
          ],
          [
            13,
            70,
            0.6
          ],
          [
            7.5,
            10,
            0.35
          ],
          [
            4.2,
            120,
            0.2
          ]
        ],
        "chop": 0.35,
        "max": 0.45,
        "weather": {
          "windRef": 12,
          "minScale": 0.45,
          "maxScale": 1,
          "rate": 0.2
        }
      },
      "rail": {
        "underground": {
          "_note": "nyc-complete NC6 (game.js _underFog / _underLight): in a station void the far plane is far m, fog fogNear..fogFar in fogColor, sun x sunMul, hemisphere light x hemiMul in hemiSky / hemiGround, env map x envMul (no weather), sky dome hidden (deep levels only). Entering / leaving a void blends street -> underground light, fog and far over blendSec s (smoothstep); a camera jump > blendJump m switches at once",
          "far": 160,
          "fogNear": 18,
          "fogFar": 120,
          "fogColor": "#0d0f12",
          "hemiMul": 0.85,
          "hemiSky": "#d6dde2",
          "hemiGround": "#9a968c",
          "sunMul": 0,
          "envMul": 0.35,
          "hideSky": true,
          "blendSec": 0.7,
          "blendJump": 5
        }
      },
      "destruct": {
        "enabled": true,
        "online": false,
        "keepNear": 200,
        "caps": {
          "records": 3000,
          "debris": 400,
          "decals": 96,
          "chips": 96,
          "exposed": 48,
          "windows": 160,
          "farCuts": 512,
          "rubble": 3000,
          "settled": 600
        },
        "mobile": {
          "caps": {
            "records": 1500,
            "debris": 160,
            "decals": 48,
            "chips": 48,
            "exposed": 24,
            "windows": 96,
            "rubble": 1200,
            "settled": 300
          },
          "breach": {
            "maxExtra": 3
          },
          "glass": {
            "maxRadius": 22
          },
          "collapse": {
            "proxyBoxesMobile": 100
          }
        },
        "gun": {
          "enabled": true,
          "cell": 1,
          "cellHp": 300,
          "cells": 2048,
          "replanSec": 0.25,
          "snapFloor": 0.6,
          "crack": [
            0.35,
            0.6,
            0.85
          ],
          "chipSize": 0.35,
          "chipDebris": 0.35,
          "mulDefault": 0.3,
          "mul": {
            "rifle": 0.4,
            "lmg": 0.4,
            "p90": 0.35,
            "shotgun": 0.3,
            "sniper": 0.5,
            "pistol": 0.15,
            "knife": 0
          }
        },
        "rubble": {
          "enabled": true,
          "settle": true,
          "blockH": 0.5,
          "minHoleW": 1.8,
          "minHoleH": 1.9,
          "low": [
            0.18,
            0.35
          ],
          "mound": [
            0.6,
            1
          ],
          "drawDist": 100,
          "drawDistMobile": 60,
          "waitSec": 20,
          "colors": [
            "#8a857c",
            "#9b968c",
            "#6f6a63",
            "#7d7870"
          ],
          "brickColors": [
            "#8b4a3a",
            "#7a3f33",
            "#9a6a58",
            "#8a857c"
          ],
          "rebarColor": "#5a3a28",
          "glassColor": "#a9c4cf",
          "scatter": {
            "breach": 48,
            "prop": 14,
            "collapse": 160
          },
          "scatterMobile": {
            "breach": 28,
            "prop": 8,
            "collapse": 90
          },
          "scatterR": {
            "breach": 7,
            "prop": 3.5,
            "collapse": 9
          },
          "rebarShare": 0.08,
          "glassShare": 0.07
        },
        "ramSpeed": 5,
        "ramDamage": 30,
        "fx": {
          "enabled": true,
          "minGap": 0.25,
          "billow": 6,
          "sparks": 80,
          "sparksPerFx": 8,
          "dust": {
            "n": 24,
            "speed": 3.5,
            "grow": 0.35,
            "drag": 0.9,
            "alpha": 0.55,
            "life": [
              12,
              22
            ],
            "color": [
              0.42,
              0.38,
              0.33
            ],
            "wind": 1
          },
          "column": {
            "n": 3,
            "life": [
              14,
              24
            ],
            "alpha": 0.7,
            "sec": 32,
            "every": 0.8,
            "max": 3,
            "puffLife": [
              10,
              16
            ]
          },
          "debris": {
            "chip": 24,
            "chunk": 16,
            "slab": 6
          },
          "fireball": {
            "scale": 4,
            "core": [
              3,
              2.8,
              2.4
            ],
            "coreSize": 1.4,
            "coreSec": 0.12,
            "ring": 1.5
          },
          "flash": {
            "gain": 0.9,
            "range": 220,
            "sec": 0.22,
            "max": 1.2
          },
          "haze": {
            "n": 12,
            "life": [
              26,
              36
            ],
            "alpha": 0.3,
            "size": 3.2,
            "color": [
              0.46,
              0.43,
              0.39
            ]
          },
          "burning": {
            "n": 4,
            "max": 8,
            "speed": [
              6,
              14
            ],
            "up": 9,
            "groundSec": 4,
            "fireEvery": 0.05,
            "smokeEvery": 0.14
          },
          "shake": {
            "range": 140,
            "kick": 0.5,
            "rumble": 0.6,
            "rumbleMax": 1.5,
            "max": 2
          },
          "screenDust": {
            "range": 30,
            "gain": 0.7,
            "wallRange": 6,
            "wallGain": 0.35,
            "fade": 2.5,
            "max": 0.85
          },
          "wall": {
            "puffs": 12,
            "speed": 6,
            "alpha": 0.6,
            "life": 6,
            "chunks": 8,
            "chips": 12,
            "slabs": 4,
            "push": 5,
            "exposed": 1.4
          },
          "sound": {
            "crackRange": 250,
            "rumbleRange": 1200,
            "debrisRange": 160
          },
          "wind": [
            0.8,
            0.3
          ],
          "windScale": 0.5,
          "mobile": {
            "billow": 4,
            "sparks": 40,
            "sparksPerFx": 5,
            "dust": {
              "n": 16,
              "speed": 3.5,
              "grow": 0.35,
              "drag": 0.9,
              "alpha": 0.55,
              "life": [
                10,
                16
              ],
              "color": [
                0.42,
                0.38,
                0.33
              ],
              "wind": 1
            },
            "column": {
              "n": 2,
              "life": [
                12,
                18
              ],
              "alpha": 0.7,
              "sec": 28,
              "every": 1.1,
              "max": 2,
              "puffLife": [
                9,
                14
              ]
            },
            "debris": {
              "chip": 16,
              "chunk": 10,
              "slab": 4
            },
            "fireball": {
              "scale": 3,
              "core": [
                3,
                2.8,
                2.4
              ],
              "coreSize": 1.3,
              "coreSec": 0.12,
              "ring": 1.4
            },
            "haze": {
              "n": 8,
              "life": [
                24,
                32
              ],
              "alpha": 0.3,
              "size": 3.2,
              "color": [
                0.46,
                0.43,
                0.39
              ]
            },
            "burning": {
              "n": 3,
              "max": 5,
              "speed": [
                6,
                14
              ],
              "up": 9,
              "groundSec": 3,
              "fireEvery": 0.07,
              "smokeEvery": 0.2
            },
            "wall": {
              "puffs": 8,
              "speed": 6,
              "alpha": 0.6,
              "life": 5,
              "chunks": 6,
              "chips": 8,
              "slabs": 2,
              "push": 5,
              "exposed": 1.4
            }
          }
        },
        "scale": {
          "struct": 2
        },
        "collapse": {
          "enabled": true,
          "partialAt": 0.55,
          "tallFrom": 120,
          "lowFrom": 40,
          "tallKeep": 0.45,
          "partialK": 0.55,
          "moundK": 0.12,
          "moundMin": 1.4,
          "moundMax": 7,
          "hpPerM2": {
            "walkup": 1.8,
            "lowrise": 1.5,
            "warehouse": 1.3,
            "midrise": 2.1,
            "tower": 3.2,
            "default": 1.8
          },
          "kindMul": {
            "missile": 1,
            "blast": 1,
            "vehicle": 0.6
          },
          "upperMul": 0.35,
          "gunMul": 0.05,
          "kinds": [
            "walkup",
            "lowrise",
            "warehouse",
            "midrise",
            "tower"
          ],
          "protect": [],
          "warnSec": 1.75,
          "warnText": "建物が崩れる！",
          "fallK": 0.25,
          "fallMax": 25,
          "fallSec": 3.2,
          "fallSecMax": 5.5,
          "pushOut": 4,
          "pushDamage": 15,
          "proxyBoxes": 300,
          "proxyBoxesMobile": 160,
          "farMs": 2,
          "farMsMobile": 1.2,
          "fall": {
            "hold": 0.35,
            "ease": 1.7,
            "squash": 0.35,
            "sink": 1.05,
            "partialTilt": 0.5,
            "tallTilt": 0.55,
            "tallDrop": 1,
            "tallK": 1.25,
            "shake": 0.12,
            "every": 0.08,
            "everyMobile": 0.1,
            "dustUp": 3.5,
            "dustK": 0.9,
            "dustGrow": 0.3,
            "peel": 5
          },
          "wave": {
            "n": 48,
            "nMobile": 24,
            "speed": 22,
            "drag": 0.3,
            "alpha": 0.78,
            "life": 26,
            "maxSize": 32,
            "maxSizeMobile": 22,
            "screenDust": 90,
            "color": [
              0.56,
              0.51,
              0.44
            ]
          }
        },
        "glass": {
          "enabled": true,
          "bullets": true,
          "radiusK": 1.55,
          "maxRadius": 44,
          "maxPerBlast": 48,
          "immediate": 2,
          "waveSpeed": 120,
          "perFrame": 6,
          "queueMax": 96,
          "minDamage": 80,
          "push": 6,
          "shards": 5,
          "glints": 3,
          "winW": 0.48,
          "winH": 0.44,
          "corniceDamage": 200,
          "corniceSlabs": [
            2,
            4
          ],
          "corniceChunks": [
            4,
            7
          ],
          "roomFire": {
            "enabled": true,
            "minDamage": 300,
            "depth": 2.2,
            "r0": 0.7,
            "r1": 1.6,
            "sec": 25
          }
        },
        "breach": {
          "maxExtra": 6,
          "extraPerFrame": 2,
          "extraGap": 0.6,
          "storey": 3.6,
          "width": 3,
          "height": 2.5,
          "reach": 2.5,
          "wall": 0.3,
          "rubbleH": 0.25,
          "minFace": 0.3,
          "minDamage": 120,
          "scorch": 2.4,
          "debris": [
            10,
            16
          ],
          "debrisIn": [
            4,
            7
          ]
        },
        "crater": {
          "minDamage": 60,
          "maxScale": 2.5,
          "size": 3.4,
          "gunSize": 0.9,
          "kit": "rubble",
          "debris": [
            10,
            14
          ]
        },
        "props": {
          "trash_can": {
            "dims": [
              [
                0.64,
                0.89,
                0.64
              ]
            ],
            "hp": 60,
            "r": 0.35,
            "cy": 0.45,
            "kit": "metal",
            "n": [
              4,
              6
            ],
            "sound": "impact_metal"
          },
          "mailbox": {
            "dims": [
              [
                0.54,
                1.2,
                0.54
              ]
            ],
            "hp": 80,
            "r": 0.3,
            "cy": 0.6,
            "kit": "metal",
            "n": [
              4,
              6
            ],
            "sound": "impact_metal"
          },
          "hydrant": {
            "dims": [
              [
                0.5,
                0.77,
                0.5
              ]
            ],
            "hp": 150,
            "r": 0.3,
            "cy": 0.4,
            "kit": "metal",
            "n": [
              3,
              5
            ],
            "sound": "impact_metal"
          },
          "newsstand": {
            "dims": [
              [
                3,
                2.45,
                1.6
              ]
            ],
            "hp": 120,
            "r": 1.6,
            "cy": 1.2,
            "kit": "wood",
            "n": [
              8,
              12
            ],
            "kit2": "metal",
            "n2": [
              3,
              5
            ],
            "sound": "impact_concrete",
            "rate": 0.75
          },
          "phone_kiosk": {
            "dims": [
              [
                0.96,
                2.85,
                0.96
              ]
            ],
            "hp": 100,
            "r": 0.5,
            "cy": 1.4,
            "kit": "glass",
            "n": [
              8,
              12
            ],
            "kit2": "metal",
            "n2": [
              2,
              4
            ],
            "sound": "impact_metal",
            "rate": 1.6
          },
          "bench": {
            "dims": [
              [
                1.84,
                0.5,
                0.6
              ]
            ],
            "hp": 70,
            "r": 0.95,
            "cy": 0.3,
            "kit": "wood",
            "n": [
              5,
              8
            ],
            "sound": "impact_concrete",
            "rate": 0.75
          },
          "planter": {
            "dims": [
              [
                1.28,
                0.72,
                1.28
              ],
              [
                6,
                0.6,
                1.5
              ]
            ],
            "hp": 140,
            "r": 0.7,
            "cy": 0.4,
            "kit": "concrete",
            "n": [
              5,
              8
            ],
            "sound": "impact_concrete"
          },
          "crate": {
            "dims": [
              [
                1.24,
                1.25,
                1.24
              ]
            ],
            "hp": 50,
            "r": 0.65,
            "cy": 0.6,
            "kit": "wood",
            "n": [
              5,
              8
            ],
            "sound": "impact_concrete",
            "rate": 0.75
          },
          "crate_tall": {
            "dims": [
              [
                1.24,
                2.5,
                1.24
              ]
            ],
            "hp": 70,
            "r": 0.65,
            "cy": 1.2,
            "kit": "wood",
            "n": [
              6,
              9
            ],
            "sound": "impact_concrete",
            "rate": 0.75
          },
          "hvac_unit": {
            "dims": [
              [
                2.3,
                1.33,
                1.4
              ]
            ],
            "hp": 160,
            "r": 1.2,
            "cy": 0.7,
            "kit": "metal",
            "n": [
              5,
              8
            ],
            "sound": "impact_metal"
          },
          "water_tank": {
            "dims": [
              [
                0.24,
                2.84,
                0.24,
                0
              ],
              [
                3.9,
                3.76,
                3.9,
                2.84
              ]
            ],
            "tier": "tank",
            "hp": 400,
            "r": 2.3,
            "cy": 4.5,
            "kit": "wood",
            "n": [
              12,
              16
            ],
            "wreckH": 0.9,
            "wreckR": 1.7,
            "sound": "impact_concrete",
            "rate": 0.75
          }
        },
        "debris": {
          "gravity": 14,
          "restitution": 0.3,
          "friction": 0.5,
          "maxBounces": 3,
          "life": [
            6,
            10
          ],
          "fade": 1.2,
          "soundRange": 80,
          "soundEvery": 0.15,
          "soundSpeed": 4,
          "sound": "impact_concrete",
          "kits": {
            "concrete": {
              "size": [
                0.14,
                0.5
              ],
              "speed": [
                3,
                9
              ],
              "up": [
                2,
                7
              ],
              "inherit": 1,
              "spin": 7,
              "color": "#77726a",
              "life": [
                6,
                10
              ]
            },
            "rubble": {
              "size": [
                0.22,
                0.7
              ],
              "speed": [
                4,
                12
              ],
              "up": [
                5,
                11
              ],
              "inherit": 1,
              "spin": 7,
              "color": "#6f6a62",
              "life": [
                6,
                10
              ]
            },
            "metal": {
              "size": [
                0.07,
                0.28
              ],
              "speed": [
                3,
                8
              ],
              "up": [
                3,
                7
              ],
              "inherit": 1,
              "spin": 9,
              "color": "#3e4a44",
              "life": [
                5,
                8
              ]
            },
            "wood": {
              "size": [
                0.12,
                0.5
              ],
              "speed": [
                3,
                8
              ],
              "up": [
                3,
                7
              ],
              "inherit": 1,
              "spin": 8,
              "flat": 0.22,
              "color": "#7a5a36",
              "life": [
                5,
                8
              ]
            },
            "car": {
              "size": [
                0.15,
                0.6
              ],
              "speed": [
                4,
                11
              ],
              "up": [
                4,
                9
              ],
              "inherit": 1,
              "spin": 8,
              "flat": 0.35,
              "color": "#2b2d30",
              "n": [
                8,
                12
              ],
              "life": [
                6,
                10
              ]
            },
            "glass": {
              "size": [
                0.05,
                0.2
              ],
              "speed": [
                2,
                7
              ],
              "up": [
                2,
                5
              ],
              "inherit": 1,
              "spin": 10,
              "flat": 0.12,
              "color": "#a9c4cc",
              "life": [
                3,
                5
              ]
            },
            "dxChip": {
              "size": [
                0.05,
                0.16
              ],
              "speed": [
                8,
                20
              ],
              "up": [
                4,
                12
              ],
              "inherit": 1,
              "spin": 14,
              "color": "#6e6a63",
              "life": [
                3,
                6
              ]
            },
            "dxChunk": {
              "size": [
                0.9,
                2.2
              ],
              "speed": [
                5,
                14
              ],
              "up": [
                5,
                12
              ],
              "inherit": 1,
              "spin": 9,
              "color": "#5e5953",
              "life": [
                10,
                16
              ]
            },
            "dxSlab": {
              "size": [
                2,
                4
              ],
              "speed": [
                3,
                8
              ],
              "up": [
                4,
                9
              ],
              "inherit": 1,
              "spin": 6,
              "flat": 0.3,
              "color": "#57524c",
              "life": [
                12,
                18
              ]
            }
          }
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
        "textureMaxMobile": {
          "map": 1024,
          "detail": 512
        },
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
            "flares": {
              "count": 30,
              "burst": 2,
              "cooldown": 1.5,
              "reloadTime": 12,
              "autoRange": 1500,
              "autoTime": 3.5,
              "rwrEvery": 1,
              "ejectDrop": 12,
              "ejectSide": 4
            },
            "rwr": {
              "searchTone": 0.08,
              "lockTone": 0.14,
              "markerSec": 2.5,
              "spikeHold": 1
            },
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
            "chaseNear": 0.3,
            "chaseHullMargin": 1,
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
              "clearViewDist": 300,
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
            "bombs": {
              "loadout": [
                [
                  "gbu_l",
                  "gbu16"
                ],
                [
                  "gbu_r",
                  "gbu16"
                ]
              ],
              "reloadTime": 90
            },
            "missile": {
              "loadout": [
                [
                  "aim9x_l",
                  "aim9x"
                ],
                [
                  "aim9x_r",
                  "aim9x"
                ],
                [
                  "aim120_l",
                  "aim120"
                ],
                [
                  "aim120_r",
                  "aim120"
                ]
              ],
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
              "count": 60,
              "burst": 3,
              "cooldown": 1.2,
              "autoRange": 1800,
              "autoTime": 3.5,
              "reloadTime": 8,
              "rwrEvery": 1
            },
            "rwr": {
              "searchTone": 0.08,
              "lockTone": 0.14,
              "markerSec": 2.5,
              "spikeHold": 1
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
          },
          "vtol": {
            "name": "MIRRSONA",
            "kind": "vtol",
            "model": "models/vtol.glb",
            "fallback": "vtol",
            "scale": 1,
            "length": 24.8,
            "width": 44,
            "height": 5.52,
            "wheelRadius": 0.55,
            "health": 2400,
            "armor": 0.5,
            "driverExposure": 0,
            "maxSpeed": 190,
            "maxSpeedHover": 25,
            "maxStrafeHover": 14,
            "maxBackHover": 10,
            "hoverAccel": 5,
            "hoverBrake": 7,
            "posHoldK": 0.6,
            "posHoldMax": 4,
            "climbRate": 8,
            "descendRate": 6,
            "vAccel": 5,
            "vBrake": 8,
            "altHoldK": 1,
            "thrustHover": 1.45,
            "thrustCruise": 0.55,
            "gLimit": 3.5,
            "maneuver": {
              "maxG": 4
            },
            "stallSpeed": 55,
            "stallBand": 8,
            "convFrom": 25,
            "convTo": 60,
            "podRate": 35,
            "minHoverTilt": 10,
            "hoverDeg": -90,
            "cruiseSpeed": 110,
            "spdRate": 18,
            "cruiseVAccel": 12,
            "transHold": 0.6,
            "transSpeedK": 0.85,
            "turnLead": 40,
            "turnK": 1.2,
            "climbAngle": 18,
            "diveAngle": 14,
            "altLead": 1,
            "speedK": 0.8,
            "cruiseVyK": 0.5,
            "yawFollow": 1.4,
            "maxYawRate": 28,
            "yawAccel": 50,
            "spinUpTime": 4,
            "spinDownTime": 8,
            "liftSpool": 0.85,
            "groundEffect": 10,
            "touchdownSpeed": 1,
            "landingSpeed": 3.5,
            "landingMaxSpeed": 4,
            "landingSlope": 0.08,
            "landingDamage": 60,
            "crashSink": 9,
            "crashSpeed": 16,
            "impactSpeed": 3,
            "impactDamage": 30,
            "bounce": 0.25,
            "gearAgl": 50,
            "gearUpAgl": 80,
            "gearSpeed": 70,
            "gearTime": 3,
            "gearRot": 95,
            "rampDeg": -30.43,
            "maxAltitude": 900,
            "boundsMargin": 250,
            "avoid": {
              "lookTime": 6,
              "clear": 45,
              "step": 40,
              "every": 0.25,
              "radius": 26,
              "hoverClearK": 0.5,
              "climb": 10,
              "vMin": 6
            },
            "tiltGain": 0.5,
            "pitchMax": 14,
            "rollMax": 35,
            "tiltRate": 3,
            "respawn": 60,
            "explodeRadius": 22,
            "explodeDamage": 300,
            "wreckGravity": 14,
            "wreckSmokeEvery": 0.5,
            "chaseDistance": 44,
            "chaseHeight": 10,
            "chaseSpeedDist": 12,
            "cameraRoll": 0.2,
            "chaseFovBoost": 10,
            "cockpitFovBoost": 5,
            "washHeight": 22,
            "navOpsPerFrame": 1,
            "navLeadMax": 300,
            "navLeadAgl": 400,
            "loadDist": 400,
            "unloadDist": 650,
            "padMinSize": 48,
            "board": {
              "exterior": false,
              "seatReach": 1,
              "facing": 70,
              "hintDist": 14
            },
            "ramp": {
              "time": 3,
              "landedSpeed": 0.3,
              "levelTiltMax": 2.5,
              "autoOpenParked": true,
              "autoOpenDist": 6,
              "openOnStandUp": true,
              "footTolWalk": 0.45,
              "footTolHigh": 0.15,
              "closeWait": 1,
              "sweepPad": 0.3,
              "pushOut": 1.2,
              "interiorDist": 45,
              "doorEnd": 0.4,
              "plateFrom": 0.2,
              "plateTo": 0.8,
              "toeFrom": 0.6
            },
            "cargo": {
              "enabled": true,
              "captureEvery": 0.25,
              "zoneAngle": 30,
              "zoneSpeed": 8,
              "allowReverse": true,
              "alignPad": 0.3,
              "accel": 3,
              "decel": 3,
              "groundSpeed": 4.5,
              "rampSpeed": 3,
              "holdMax": 2,
              "unloadStick": 0.5,
              "unloadHold": 0.3,
              "exitSpeed": 3,
              "footTol": 0.15,
              "clearMargin": 0.05,
              "maxCars": 1,
              "autoExitDriver": true,
              "blastHostDamage": 150,
              "toastEvery": 4,
              "hintDist": 14,
              "enterDy": 2.6,
              "barrierPad": 0.45
            },
            "hud": {
              "tutorialTime": 6
            },
            "airKillAgl": 12,
            "respawnClear": 30,
            "unmannedHold": 3,
            "unmannedDescend": 3,
            "hoverGain": 1.5,
            "cantLandGap": 0.02,
            "cantLandTime": 1,
            "wreck": {
              "keepVel": 0.5,
              "maxUp": 4,
              "spin": 0.5,
              "drag": 0.3,
              "maxFall": 60
            },
            "camRecenter": {
              "delay": 1.5,
              "rate": 1.5,
              "pitch": -0.12
            },
            "chaseClamp": {
              "min": 0.15,
              "wallPad": 1.2,
              "ease": 2.5
            },
            "chasePivot": [
              0,
              4.5,
              -1
            ],
            "flares": {
              "count": 30,
              "burst": 2,
              "cooldown": 1.5,
              "reloadTime": 12,
              "autoRange": 1500,
              "autoTime": 3.5,
              "rwrEvery": 1,
              "ejectDrop": 12,
              "ejectSide": 10
            },
            "rwr": {
              "searchTone": 0.08,
              "lockTone": 0.14,
              "markerSec": 2.5,
              "spikeHold": 1
            },
            "gun": {
              "rate": 40,
              "ammo": 800,
              "damage": 26,
              "range": 1400,
              "convergence": 400,
              "spread": 0.35,
              "tracerEvery": 3,
              "burst": 0.6,
              "tracerSpeed": 1000,
              "gunYaw": 30,
              "gunPitchUp": 15,
              "gunPitchDown": 60,
              "muzzle": [
                12.4,
                2.57,
                4.5
              ],
              "hoverAimSpeed": 30
            },
            "missile": {
              "loadout": [
                [
                  "aim9x_l0",
                  "aim9x"
                ],
                [
                  "aim9x_r0",
                  "aim9x"
                ],
                [
                  "aim9x_l1",
                  "aim9x"
                ],
                [
                  "aim9x_r1",
                  "aim9x"
                ]
              ],
              "reloadTime": 45,
              "lockCone": 22,
              "lockRange": 3000,
              "lockMin": 150,
              "lockTime": 0.8,
              "lockKeep": 30,
              "lockClear": 6,
              "lockHide": 0.6,
              "lockScan": 0.25,
              "cooldown": 0.8
            },
            "bombs": {
              "loadout": [
                [
                  "gbu_l",
                  "gbu16"
                ],
                [
                  "gbu_r",
                  "gbu16"
                ]
              ],
              "reloadTime": 0
            },
            "arm": {
              "armTime": 1.2,
              "armIdle": 12,
              "groundIdle": 2,
              "pending": 0.3,
              "gunDeg": 90,
              "doorDeg": 100,
              "linkDeg": 35,
              "rackDrop": 0.45,
              "drag": 1.08,
              "mergedCache": 2,
              "slots": {
                "aim9x_l0": [
                  "bay_rack_l",
                  0.55,
                  -0.3,
                  0
                ],
                "aim9x_l1": [
                  "bay_rack_l",
                  -0.55,
                  -0.3,
                  0
                ],
                "aim9x_r0": [
                  "bay_rack_r",
                  -0.55,
                  -0.3,
                  0
                ],
                "aim9x_r1": [
                  "bay_rack_r",
                  0.55,
                  -0.3,
                  0
                ]
              }
            },
            "rearm": {
              "rearmTime": 4,
              "maxSpeed": 0.5,
              "pads": [
                "p_skyhigh",
                "p_carrier"
              ]
            },
            "rearmHint": "パッド",
            "cams": {
              "near": {
                "distance": 44,
                "height": 10,
                "speedDist": 12
              },
              "far": {
                "distance": 90,
                "height": 28,
                "speedDist": 20
              },
              "hullMargin": 0.6,
              "raiseMax": 12,
              "raiseStep": 0.25
            },
            "autopilot": {
              "posK": 0.6,
              "brake": 2.5,
              "arrive": 3,
              "wpRadius": 25,
              "wpTime": 1.2,
              "wpAlt": 2,
              "holdYawDist": 60,
              "holdYawLead": 2.5,
              "altK": 0.8,
              "cruiseFrom": 40,
              "orbitSpeed": 20,
              "orbitK": 0.5,
              "liftClear": 8
            },
            "autoland": {
              "range": 6000,
              "padRange": 1500,
              "approachAgl": 80,
              "approachSpeed": 110,
              "convDist": 900,
              "decel": 3,
              "hoverAgl": 30,
              "finalSpeed": 2.5,
              "descendRate": 5,
              "slowAgl": 12,
              "slowRate": 1.5,
              "capture": 2.5,
              "cancelStick": 0.5,
              "roadStep": 40,
              "roadTries": 12,
              "clearMargin": 3,
              "clearHeight": 7,
              "checkDist": 450,
              "alignAngle": 6,
              "holdTime": 1,
              "holdSpeed": 1.5,
              "roads": "jet"
            },
            "spawns": [
              {
                "level": "midtown",
                "id": "v_skyhigh",
                "name": "Sky High",
                "x": 0,
                "y": 274,
                "z": -208,
                "yaw": 0,
                "replaces": [
                  "h_h_tower"
                ],
                "modes": [
                  "free"
                ]
              },
              {
                "level": "midtown",
                "id": "v_carrier",
                "name": "空母",
                "carrierLocal": [
                  0,
                  86,
                  90
                ],
                "noJets": true,
                "home": true,
                "modes": [
                  "free",
                  "royale"
                ]
              }
            ],
            "pads": [
              {
                "level": "midtown",
                "id": "p_skyhigh",
                "name": "Sky High",
                "x": 0,
                "y": 274,
                "z": -208,
                "w": 52,
                "d": 36,
                "yaw": 0
              },
              {
                "level": "midtown",
                "id": "p_carrier",
                "name": "空母",
                "carrierLocal": [
                  0,
                  86,
                  90
                ],
                "noJets": true,
                "w": 52,
                "d": 31
              }
            ],
            "hull": [
              {
                "x": 0,
                "y": 3,
                "z": -10.6,
                "r": 1.63
              },
              {
                "x": 0,
                "y": 3.2,
                "z": -3.87,
                "r": 2.35
              },
              {
                "x": 0,
                "y": 3.31,
                "z": 2.87,
                "r": 2.4
              },
              {
                "x": 0,
                "y": 2.87,
                "z": 9.6,
                "r": 1.6
              },
              {
                "x": 5,
                "y": 2.86,
                "z": 1.53,
                "r": 1.52
              },
              {
                "x": 8.16,
                "y": 2.67,
                "z": -0.19,
                "r": 1.22
              },
              {
                "x": 11.32,
                "y": 2.65,
                "z": -2.28,
                "r": 0.86
              },
              {
                "x": 14.48,
                "y": 2.65,
                "z": -2.93,
                "r": 0.73
              },
              {
                "x": 17.64,
                "y": 2.66,
                "z": -3.66,
                "r": 0.6
              },
              {
                "x": 20.8,
                "y": 2.65,
                "z": -3.67,
                "r": 0.6
              },
              {
                "x": -5,
                "y": 2.86,
                "z": 1.53,
                "r": 1.52
              },
              {
                "x": -8.16,
                "y": 2.67,
                "z": -0.19,
                "r": 1.22
              },
              {
                "x": -11.32,
                "y": 2.65,
                "z": -2.28,
                "r": 0.86
              },
              {
                "x": -14.48,
                "y": 2.65,
                "z": -2.79,
                "r": 0.73
              },
              {
                "x": -17.64,
                "y": 2.66,
                "z": -3.66,
                "r": 0.6
              },
              {
                "x": -20.8,
                "y": 2.65,
                "z": -3.67,
                "r": 0.6
              }
            ],
            "boxes": [
              {
                "x0": -3.6,
                "y0": 1.02,
                "z0": -13.2,
                "x1": 3.6,
                "y1": 5.52,
                "z1": 11.6,
                "tag": "fuselage"
              },
              {
                "x0": 3.6,
                "y0": 1.5,
                "z0": -12.33,
                "x1": 22,
                "y1": 4.29,
                "z1": 9.28,
                "tag": "wing_l"
              },
              {
                "x0": -22,
                "y0": 1.5,
                "z0": -12.33,
                "x1": -3.6,
                "y1": 4.29,
                "z1": 9.28,
                "tag": "wing_r"
              },
              {
                "x0": 6.24,
                "y0": 1.71,
                "z0": -4.03,
                "x1": 10.16,
                "y1": 3.62,
                "z1": 0.03,
                "tag": "pod_l"
              },
              {
                "x0": -10.16,
                "y0": 1.71,
                "z0": -4.03,
                "x1": -6.24,
                "y1": 3.62,
                "z1": 0.03,
                "tag": "pod_r"
              },
              {
                "x0": -1.39,
                "y0": 1.22,
                "z0": -9,
                "x1": 1.39,
                "y1": 2.25,
                "z1": -6.6,
                "tag": "ramp"
              }
            ],
            "contacts": [
              {
                "gear": "n",
                "x": 0,
                "y": 0,
                "z": 4.4
              },
              {
                "gear": "l",
                "x": 4.1,
                "y": 0,
                "z": -4
              },
              {
                "gear": "r",
                "x": -4.1,
                "y": 0,
                "z": -4
              },
              {
                "gear": "belly",
                "x": 0,
                "y": 1.02,
                "z": 0.919
              }
            ],
            "seat": [
              0,
              3.7,
              5.8
            ],
            "exit": [
              5,
              0,
              11.5
            ],
            "seats": [
              {
                "node": "seat_pilot",
                "exitNode": "exit_l",
                "seat": [
                  0,
                  3.7,
                  5.8
                ],
                "exit": [
                  5,
                  0,
                  11.5
                ]
              },
              {
                "node": "seat_copilot",
                "exitNode": "exit_r",
                "seat": [
                  -0.9,
                  3.6,
                  6.85
                ],
                "exit": [
                  -5,
                  0,
                  11.5
                ]
              }
            ],
            "color": "#c9ced6"
          },
          "speedboat": {
            "name": "ボート",
            "node": "speedboat",
            "fallback": "speedboat",
            "kind": "boat",
            "model": "models/boats.glb",
            "length": 7.9,
            "width": 2.64,
            "height": 2.2,
            "wheelRadius": 0.5,
            "impactSpeed": 4,
            "impactDamage": 9,
            "bounce": 0.25,
            "collisionSpin": 0.4,
            "scrape": 1.2,
            "runOverSpeed": 3,
            "explodeRadius": 6,
            "explodeDamage": 130,
            "sinkTime": 6,
            "respawn": 40,
            "cameraRoll": 0.35,
            "chaseDistance": 9,
            "chaseHeight": 3.2,
            "seatSwitchSpeed": 2,
            "health": 420,
            "armor": 0.9,
            "driverExposure": 0.5,
            "maxSpeed": 24,
            "maxReverse": 4,
            "thrust": 7.5,
            "reverseThrust": 3,
            "dragDisp": 0.045,
            "dragPlane": 0.018,
            "planeSpeed": 9,
            "humpSpeed": 5.5,
            "humpPitch": 6,
            "planePitch": 2.5,
            "planeLift": 0.18,
            "pitchPivotZ": -1.2,
            "sternFreeboardMin": 0.08,
            "turnRate": 55,
            "turnRefSpeed": 6,
            "highSpeedTurn": 0.55,
            "propSteer": 0.35,
            "steerSpeed": 4,
            "lateralGrip": 2.2,
            "lateralGripPlane": 1.1,
            "leanGain": 0.018,
            "leanMax": 14,
            "buoyK": 28,
            "buoyDamp": 7,
            "waveFollow": 1,
            "airGravity": 14,
            "hullCircles": 3,
            "subStep": 0.5,
            "beachDecel": 6,
            "fovBoost": 6,
            "wake": {
              "width": 1.2,
              "spread": 1.4,
              "life": 9,
              "every": 0.12
            },
            "spray": {
              "rate": 40,
              "minSpeed": 7
            },
            "audio": {
              "rateMin": 0.7,
              "rateMax": 1.8,
              "planeFrom": 7,
              "planeFull": 16
            },
            "color": "#d8dde2",
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit_driver",
                "seat": [
                  0,
                  1.72,
                  -0.5
                ],
                "exit": [
                  -1.8,
                  0,
                  -0.5
                ]
              },
              {
                "node": "seat_p1",
                "exitNode": "exit_p1",
                "seat": [
                  0,
                  1.72,
                  -1.4
                ],
                "exit": [
                  1.8,
                  0,
                  -1.4
                ]
              },
              {
                "node": "seat_p2",
                "exitNode": "exit_p2",
                "seat": [
                  0.4,
                  1.3,
                  2.2
                ],
                "exit": [
                  1.8,
                  0,
                  2
                ]
              },
              {
                "node": "seat_p3",
                "exitNode": "exit_p3",
                "seat": [
                  -0.4,
                  1.3,
                  2.2
                ],
                "exit": [
                  -1.8,
                  0,
                  2
                ]
              }
            ]
          },
          "patrol_boat": {
            "name": "警備艇",
            "node": "patrol_boat",
            "fallback": "patrol_boat",
            "kind": "boat",
            "model": "models/boats.glb",
            "length": 12.2,
            "width": 4.08,
            "height": 3.2,
            "wheelRadius": 0.5,
            "impactSpeed": 4,
            "impactDamage": 9,
            "bounce": 0.25,
            "collisionSpin": 0.4,
            "scrape": 1.2,
            "runOverSpeed": 3,
            "explodeRadius": 8,
            "explodeDamage": 150,
            "sinkTime": 6,
            "respawn": 40,
            "cameraRoll": 0.35,
            "chaseDistance": 13,
            "chaseHeight": 4.2,
            "seatSwitchSpeed": 2,
            "health": 900,
            "armor": 0.6,
            "driverExposure": 0.25,
            "maxSpeed": 21,
            "maxReverse": 4,
            "thrust": 6,
            "reverseThrust": 3,
            "dragDisp": 0.045,
            "dragPlane": 0.018,
            "planeSpeed": 9,
            "humpSpeed": 5.5,
            "humpPitch": 5,
            "planePitch": 2,
            "planeLift": 0.18,
            "pitchPivotZ": -2,
            "sternFreeboardMin": 0.08,
            "turnRate": 42,
            "turnRefSpeed": 6,
            "highSpeedTurn": 0.55,
            "propSteer": 0.35,
            "steerSpeed": 4,
            "lateralGrip": 2.2,
            "lateralGripPlane": 1.1,
            "leanGain": 0.018,
            "leanMax": 14,
            "buoyK": 28,
            "buoyDamp": 7,
            "waveFollow": 1,
            "airGravity": 14,
            "hullCircles": 4,
            "subStep": 0.5,
            "beachDecel": 6,
            "fovBoost": 6,
            "wake": {
              "width": 1.8,
              "spread": 1.6,
              "life": 10,
              "every": 0.12
            },
            "spray": {
              "rate": 40,
              "minSpeed": 7
            },
            "audio": {
              "rateMin": 0.7,
              "rateMax": 1.8,
              "planeFrom": 7,
              "planeFull": 16
            },
            "color": "#2a3440",
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit_driver",
                "seat": [
                  -0.45,
                  2.02,
                  0.75
                ],
                "exit": [
                  -2.5,
                  0,
                  0.8
                ]
              },
              {
                "node": "seat_p1",
                "exitNode": "exit_p1",
                "seat": [
                  0.45,
                  2.02,
                  0.75
                ],
                "exit": [
                  2.5,
                  0,
                  0.8
                ]
              },
              {
                "node": "seat_p2",
                "exitNode": "exit_p2",
                "seat": [
                  0.85,
                  2.4,
                  -3
                ],
                "exit": [
                  2.5,
                  0,
                  -3
                ]
              },
              {
                "node": "seat_p3",
                "exitNode": "exit_p3",
                "seat": [
                  -0.85,
                  2.4,
                  -3
                ],
                "exit": [
                  -2.5,
                  0,
                  -3
                ]
              },
              {
                "node": "seat_p4",
                "exitNode": "exit_p4",
                "seat": [
                  0,
                  3.05,
                  3.6
                ],
                "exit": [
                  2.4,
                  0,
                  3.6
                ]
              }
            ]
          },
          "water_taxi": {
            "name": "水上タクシー",
            "node": "water_taxi",
            "fallback": "water_taxi",
            "kind": "boat",
            "model": "models/boats.glb",
            "length": 14.95,
            "width": 4.36,
            "height": 3.6,
            "wheelRadius": 0.5,
            "impactSpeed": 4,
            "impactDamage": 9,
            "bounce": 0.25,
            "collisionSpin": 0.4,
            "scrape": 1.2,
            "runOverSpeed": 3,
            "explodeRadius": 8,
            "explodeDamage": 150,
            "sinkTime": 6,
            "respawn": 40,
            "cameraRoll": 0.35,
            "chaseDistance": 15,
            "chaseHeight": 5,
            "seatSwitchSpeed": 2,
            "health": 1100,
            "armor": 0.6,
            "driverExposure": 0.15,
            "maxSpeed": 15,
            "maxReverse": 4,
            "thrust": 3.6,
            "reverseThrust": 2,
            "dragDisp": 0.045,
            "dragPlane": 0.018,
            "planeSpeed": 99,
            "humpSpeed": 99,
            "humpPitch": 2,
            "planePitch": 0,
            "planeLift": 0,
            "pitchPivotZ": -2.5,
            "sternFreeboardMin": 0.08,
            "turnRate": 32,
            "turnRefSpeed": 6,
            "highSpeedTurn": 0.55,
            "propSteer": 0.2,
            "steerSpeed": 4,
            "lateralGrip": 2.6,
            "lateralGripPlane": 2.6,
            "leanGain": 0.008,
            "leanMax": 5,
            "buoyK": 28,
            "buoyDamp": 7,
            "waveFollow": 1,
            "airGravity": 14,
            "hullCircles": 4,
            "subStep": 0.5,
            "beachDecel": 6,
            "fovBoost": 6,
            "wake": {
              "width": 2,
              "spread": 1.2,
              "life": 11,
              "every": 0.14
            },
            "spray": {
              "rate": 20,
              "minSpeed": 8
            },
            "audio": {
              "rateMin": 0.6,
              "rateMax": 1.3,
              "planeFrom": 99,
              "planeFull": 100
            },
            "color": "#e8c840",
            "seats": [
              {
                "node": "seat_driver",
                "exitNode": "exit_driver",
                "seat": [
                  0,
                  2.72,
                  3.45
                ],
                "exit": [
                  -2.8,
                  0,
                  3.4
                ]
              },
              {
                "node": "seat_p1",
                "exitNode": "exit_p1",
                "seat": [
                  1.38,
                  2.25,
                  2.2
                ],
                "exit": [
                  2.8,
                  0,
                  2.2
                ]
              },
              {
                "node": "seat_p2",
                "exitNode": "exit_p2",
                "seat": [
                  -1.38,
                  2.25,
                  2.2
                ],
                "exit": [
                  -2.8,
                  0,
                  2.2
                ]
              },
              {
                "node": "seat_p3",
                "exitNode": "exit_p3",
                "seat": [
                  1.38,
                  2.25,
                  0
                ],
                "exit": [
                  2.8,
                  0,
                  0
                ]
              },
              {
                "node": "seat_p4",
                "exitNode": "exit_p4",
                "seat": [
                  -1.38,
                  2.25,
                  0
                ],
                "exit": [
                  -2.8,
                  0,
                  0
                ]
              },
              {
                "node": "seat_p5",
                "exitNode": "exit_p5",
                "seat": [
                  0.8,
                  2.25,
                  -6.6
                ],
                "exit": [
                  2.7,
                  0,
                  -5.5
                ]
              },
              {
                "node": "seat_p6",
                "exitNode": "exit_p6",
                "seat": [
                  -0.8,
                  2.25,
                  -6.6
                ],
                "exit": [
                  -2.7,
                  0,
                  -5.5
                ]
              }
            ]
          }
        }
      },
      "v17": {
        "_note": "ビルド 17 からのアプリだけが読む上書き（Game.overlay が config に深く重ねる。b17 の検証 S5）。ビルド 16.x のアプリは上の値（16.2 と同じ）のまま = 古いアプリで銃の穴・上限が倍にならない。変えるのはこちら",
        "destruct": {
          "caps": {
            "debris": 800,
            "rubble": 9000,
            "settled": 1800
          },
          "mobile": {
            "caps": {
              "debris": 320,
              "rubble": 3000,
              "settled": 900
            }
          },
          "gun": {
            "mul": {
              "rifle": 0.8,
              "lmg": 0.8,
              "p90": 0.7,
              "shotgun": 0.6,
              "sniper": 1,
              "pistol": 0.3
            }
          }
        },
        "puffs": {
          "caps": {
            "smoke": 320,
            "explosion": 96,
            "fire": 256,
            "ember": 192
          },
          "mobile": {
            "caps": {
              "smoke": 160,
              "explosion": 64,
              "fire": 128,
              "ember": 96
            }
          }
        },
        "explosives": {
          "blasts": {
            "aim9x": {
              "fx": 4.5
            },
            "aim120": {
              "fx": 5.25
            },
            "manpads": {
              "fx": 4.5
            }
          }
        }
      }
    },
    "config/interiors.json": {
      "version": 1,
      "salt": 1718973038,
      "levels": {
        "midtown": {
          "idPattern": "^L"
        }
      },
      "kinds": [
        "walkup",
        "lowrise",
        "warehouse",
        "lobby"
      ],
      "use": {
        "default": {
          "ground": {
            "shop": 0.6,
            "office": 0.4
          },
          "upper": {
            "apartment": 0.6,
            "office": 0.4
          }
        },
        "midtown_core": {
          "ground": {
            "shop": 0.55,
            "lobby": 0.25,
            "office": 0.2
          },
          "upper": {
            "office": 0.85,
            "apartment": 0.15
          }
        },
        "hudson_yards": {
          "ground": {
            "shop": 0.55,
            "lobby": 0.25,
            "office": 0.2
          },
          "upper": {
            "office": 0.85,
            "apartment": 0.15
          }
        },
        "residential_east": {
          "ground": {
            "shop": 0.45,
            "apartment": 0.45,
            "lobby": 0.1
          },
          "upper": {
            "apartment": 0.9,
            "office": 0.1
          }
        },
        "residential_west": {
          "ground": {
            "shop": 0.45,
            "apartment": 0.45,
            "lobby": 0.1
          },
          "upper": {
            "apartment": 0.9,
            "office": 0.1
          }
        },
        "roosevelt": {
          "ground": {
            "apartment": 0.6,
            "shop": 0.4
          },
          "upper": {
            "apartment": 1
          }
        },
        "industrial_west": {
          "ground": {
            "workshop": 0.55,
            "shop": 0.25,
            "office": 0.2
          },
          "upper": {
            "office": 0.55,
            "apartment": 0.45
          }
        },
        "queens_lowrise": {
          "ground": {
            "workshop": 0.55,
            "shop": 0.25,
            "office": 0.2
          },
          "upper": {
            "office": 0.55,
            "apartment": 0.45
          }
        },
        "queens_waterfront": {
          "ground": {
            "shop": 0.5,
            "office": 0.5
          },
          "upper": {
            "office": 0.7,
            "apartment": 0.3
          }
        }
      },
      "sub": {
        "office": {
          "open": 0.55,
          "cubicles": 0.25,
          "meeting": 0.1,
          "storage": 0.1
        },
        "warehouse": {
          "racks": 0.75,
          "workshop": 0.25
        },
        "apartment": {
          "living": 0.45,
          "bedroom": 0.35,
          "kitchen": 0.2
        }
      },
      "rules": {
        "inset": 0.05,
        "clip": 0.02,
        "doorApron": 2,
        "frontApron": 6,
        "gapApron": 2,
        "lootSquare": 3,
        "minRoom": 3,
        "meetingMinArea": 30,
        "tallMin": 1.9,
        "lowMax": 1.35,
        "stepMax": 0.42,
        "reachMargin": 0.1,
        "ceilingMargin": 0.1,
        "sillMargin": 0.05,
        "lobbySpawnDist": 4.5,
        "placeMargin": 8,
        "roofVolumeGap": 1,
        "panelEvery": {
          "office": 3,
          "warehouse": 6,
          "shop": 2,
          "lobby": 3,
          "workshop": 4
        },
        "wallPieceGap": 2,
        "wallPieceChance": 0.6,
        "wallPerCells": 7,
        "lobbyVolume": 8
      },
      "kit": {
        "desk_pod": {
          "cells": [
            2,
            2
          ],
          "h": 0.75,
          "mat": "furn_laminate"
        },
        "pod_screen": {
          "cells": [
            2,
            0
          ],
          "h": 1.25,
          "t": 0.06,
          "mat": "furn_fabric"
        },
        "cubicle": {
          "cells": [
            4,
            2
          ],
          "h": 1.9,
          "mat": "furn_fabric"
        },
        "meeting_table": {
          "cells": [
            3,
            2
          ],
          "h": 0.75,
          "mat": "furn_wood"
        },
        "meeting_table_l": {
          "cells": [
            4,
            2
          ],
          "h": 0.75,
          "mat": "furn_wood"
        },
        "filing": {
          "cells": [
            1,
            1
          ],
          "h": 1.3,
          "mat": "furn_metal"
        },
        "credenza": {
          "cells": [
            2,
            1
          ],
          "h": 1.1,
          "mat": "furn_wood"
        },
        "copier": {
          "cells": [
            1,
            1
          ],
          "h": 1.1,
          "mat": "furn_metal"
        },
        "shelf": {
          "cells": [
            2,
            1
          ],
          "h": 2,
          "mat": "furn_metal"
        },
        "shelf_1": {
          "cells": [
            1,
            1
          ],
          "h": 2,
          "mat": "furn_metal"
        },
        "pallet": {
          "cells": [
            1,
            1
          ],
          "h": 0.15,
          "mat": "furn_wood"
        },
        "pallet_low": {
          "cells": [
            1,
            1
          ],
          "h": 0.9,
          "mat": "furn_wood"
        },
        "pallet_high": {
          "cells": [
            1,
            1
          ],
          "h": 1.9,
          "mat": "furn_wood"
        },
        "rack": {
          "cells": [
            3,
            1
          ],
          "h": 3,
          "mat": "furn_metal"
        },
        "workbench": {
          "cells": [
            2,
            1
          ],
          "h": 0.9,
          "mat": "furn_wood"
        },
        "sofa": {
          "cells": [
            2,
            1
          ],
          "h": 0.85,
          "mat": "furn_fabric"
        },
        "armchair": {
          "cells": [
            1,
            1
          ],
          "h": 0.85,
          "mat": "furn_fabric"
        },
        "coffee_table": {
          "cells": [
            1,
            1
          ],
          "h": 0.42,
          "mat": "furn_wood"
        },
        "bench": {
          "cells": [
            2,
            1
          ],
          "h": 0.42,
          "mat": "furn_wood"
        },
        "tv_stand": {
          "cells": [
            2,
            1
          ],
          "h": 0.55,
          "mat": "furn_wood"
        },
        "bed": {
          "cells": [
            2,
            2
          ],
          "h": 0.55,
          "mat": "furn_fabric"
        },
        "wardrobe": {
          "cells": [
            1,
            1
          ],
          "h": 2,
          "mat": "furn_wood"
        },
        "fridge": {
          "cells": [
            1,
            1
          ],
          "h": 1.9,
          "mat": "furn_metal"
        },
        "dresser": {
          "cells": [
            2,
            1
          ],
          "h": 0.9,
          "mat": "furn_wood"
        },
        "counter": {
          "cells": [
            3,
            1
          ],
          "h": 0.9,
          "mat": "furn_laminate"
        },
        "dining": {
          "cells": [
            2,
            1
          ],
          "h": 0.75,
          "mat": "furn_wood"
        },
        "gondola": {
          "cells": [
            3,
            1
          ],
          "h": 1.9,
          "mat": "furn_metal"
        },
        "shop_counter": {
          "cells": [
            3,
            1
          ],
          "h": 1.05,
          "mat": "furn_laminate"
        },
        "display": {
          "cells": [
            2,
            1
          ],
          "h": 0.85,
          "mat": "furn_wood"
        },
        "drinks_fridge": {
          "cells": [
            2,
            1
          ],
          "h": 2,
          "mat": "furn_glass"
        },
        "reception": {
          "cells": [
            3,
            1
          ],
          "h": 1.1,
          "mat": "furn_laminate"
        },
        "planter": {
          "cells": [
            1,
            1
          ],
          "h": 0.9,
          "mat": "furn_wood"
        }
      },
      "palettes": {
        "office": {
          "laminate": [
            "#d9d4c8",
            "#c9c3b6",
            "#bfc3c7"
          ],
          "leg": [
            "#5d6166",
            "#3f4246"
          ],
          "fabric": [
            "#4f6a85",
            "#6b7681",
            "#5d7a64"
          ],
          "cap": [
            "#e3e1da"
          ],
          "metal": [
            "#7d858c",
            "#6a7279",
            "#8f969c"
          ],
          "metal_dark": [
            "#4a4f55"
          ],
          "wood": [
            "#8a6a4a",
            "#6e5038",
            "#a3825f"
          ],
          "chair": [
            "#2e3236",
            "#3b4652"
          ],
          "screen": [
            "#15181b"
          ],
          "paper": [
            "#e2dccd",
            "#2f4a6d",
            "#8a3b2e",
            "#3d5a3a",
            "#c9b48a"
          ],
          "plant": [
            "#3f6b35",
            "#4f7d3c"
          ],
          "pot": [
            "#d8d2c4",
            "#6b5a4a"
          ],
          "cooler": [
            "#dfe6ea"
          ],
          "water": [
            "#7fb3d9"
          ],
          "panel": [
            "#fff3dc"
          ],
          "glass": [
            "#c9d6dc"
          ],
          "plant2": [
            "#56883f"
          ]
        },
        "warehouse": {
          "upright": [
            "#2f5f9c",
            "#2a4f7d"
          ],
          "beam": [
            "#e07a1f",
            "#d96a16"
          ],
          "deck": [
            "#8c8f92"
          ],
          "box": [
            "#a57a4d",
            "#b88a58",
            "#8f6a43",
            "#c49a66"
          ],
          "wrap": [
            "#cfd6d8"
          ],
          "pallet": [
            "#9b7a52",
            "#8a6b45"
          ],
          "bench": [
            "#7a5a3a"
          ],
          "leg": [
            "#3f4246"
          ],
          "metal": [
            "#7d858c"
          ],
          "panel": [
            "#fff1d6"
          ]
        },
        "apartment": {
          "sofa": [
            "#7a4b3a",
            "#3f5a6b",
            "#6b6f4a",
            "#8c7f72"
          ],
          "cushion": [
            "#c9b79c",
            "#d8c9b0"
          ],
          "wood": [
            "#8a6040",
            "#a57a52",
            "#6b4a32"
          ],
          "wood2": [
            "#5e4330",
            "#7b5a40",
            "#c9b9a0"
          ],
          "leg": [
            "#2f2a26",
            "#4a443e"
          ],
          "metal": [
            "#a9adb0"
          ],
          "sheet": [
            "#e9e4da",
            "#d9dde3"
          ],
          "blanket": [
            "#5c7a9b",
            "#9b5c5c",
            "#6e8b5e",
            "#c4a66b"
          ],
          "pillow": [
            "#f2efe8"
          ],
          "appliance": [
            "#e8e8e6",
            "#c9cbcc"
          ],
          "cabinet": [
            "#d8d0c0",
            "#6a7d8c",
            "#e8e2d6"
          ],
          "counter": [
            "#3a3a3a",
            "#cfc8bb"
          ],
          "paper": [
            "#2f4a6d",
            "#8a3b2e",
            "#e2dccd",
            "#3d5a3a"
          ],
          "plant": [
            "#3f6b35",
            "#4f7d3c"
          ],
          "pot": [
            "#b5653e",
            "#d8d2c4"
          ],
          "chair": [
            "#5e4330",
            "#2f2a26"
          ],
          "screen": [
            "#121416"
          ],
          "panel": [
            "#ffe2b8"
          ]
        },
        "shop": {
          "shelfback": [
            "#e9ecee",
            "#d0d6da"
          ],
          "metal": [
            "#b7bcc0",
            "#9aa0a6"
          ],
          "product": [
            "#d9452b",
            "#2b78d9"
          ],
          "product1": [
            "#f2c230"
          ],
          "product2": [
            "#37a04a",
            "#e86a1d"
          ],
          "product3": [
            "#7a3fb0",
            "#f0f0f0"
          ],
          "product4": [
            "#2bb3c4"
          ],
          "product5": [
            "#c43b6e"
          ],
          "counter_body": [
            "#2f3a46",
            "#7a2f2f"
          ],
          "counter": [
            "#e7e2d6"
          ],
          "accent": [
            "#d9a62b",
            "#2b9fd9"
          ],
          "wood": [
            "#c9a77a",
            "#8a6a4a"
          ],
          "wood2": [
            "#5e4a3a"
          ],
          "appliance": [
            "#d8dde0"
          ],
          "fridge_glow": [
            "#d9f2ff"
          ],
          "box": [
            "#a57a4d",
            "#b88a58",
            "#8f6a43"
          ],
          "pallet": [
            "#9b7a52"
          ],
          "paper": [
            "#e2dccd",
            "#2f4a6d",
            "#8a3b2e"
          ],
          "leg": [
            "#3f4246"
          ],
          "screen": [
            "#15181b"
          ],
          "panel": [
            "#ffffff"
          ]
        },
        "lobby": {
          "reception": [
            "#3a3330",
            "#d9d2c6"
          ],
          "marble": [
            "#efece6",
            "#d8d3ca"
          ],
          "accent": [
            "#b08d57",
            "#2f2f2f"
          ],
          "wood": [
            "#7a5a3a",
            "#a57a52"
          ],
          "leg": [
            "#2f2f2f"
          ],
          "pot": [
            "#d8d2c4",
            "#3a3a3a"
          ],
          "plant": [
            "#3f6b35",
            "#4f7d3c"
          ],
          "plant2": [
            "#56883f"
          ],
          "sofa": [
            "#2f3a46"
          ],
          "cushion": [
            "#c9b79c"
          ],
          "screen": [
            "#15181b"
          ],
          "panel": [
            "#fff6e6"
          ]
        },
        "workshop": {
          "upright": [
            "#2f5f9c",
            "#2a4f7d"
          ],
          "beam": [
            "#e07a1f",
            "#d96a16"
          ],
          "deck": [
            "#8c8f92"
          ],
          "box": [
            "#a57a4d",
            "#b88a58",
            "#8f6a43",
            "#c49a66"
          ],
          "wrap": [
            "#cfd6d8"
          ],
          "pallet": [
            "#9b7a52",
            "#8a6b45"
          ],
          "bench": [
            "#7a5a3a"
          ],
          "leg": [
            "#3f4246"
          ],
          "metal": [
            "#7d858c"
          ],
          "panel": [
            "#fff1d6"
          ],
          "paper": [
            "#e2dccd",
            "#2f4a6d"
          ],
          "wood": [
            "#8a6a4a"
          ]
        }
      },
      "look": {
        "palettes": {
          "office": {
            "wall": [
              "#f2f0ea",
              "#ece6da"
            ],
            "accent_wall": [
              "#1f8a8a",
              "#e2553f",
              "#2f4fd8",
              "#e0a526"
            ],
            "skirting": [
              "#2a2d31"
            ],
            "laminate": [
              "#d8b98a",
              "#e2c79c",
              "#cfa878"
            ],
            "leg": [
              "#1e2124",
              "#2a2d31"
            ],
            "fabric": [
              "#3d7a7e",
              "#b38a3a",
              "#b0604c",
              "#7b9a6a",
              "#34476b"
            ],
            "cap": [
              "#f2f0ea"
            ],
            "metal": [
              "#b8bec4",
              "#2a2d33",
              "#1f8a8a"
            ],
            "metal_dark": [
              "#1e2124"
            ],
            "wood": [
              "#a8703f",
              "#5a3825",
              "#c48a52"
            ],
            "chair": [
              "#2b2e33",
              "#3a3d42",
              "#2b2e33",
              "#d0742e"
            ],
            "screen": [
              "#0d0f12"
            ],
            "paper": [
              "#f2f4f7",
              "#2f7bff",
              "#e2553f",
              "#3fae5a",
              "#ffc93c"
            ],
            "plant": [
              "#3f8a3a",
              "#5aa34a"
            ],
            "plant2": [
              "#6bb34f"
            ],
            "pot": [
              "#c0643a",
              "#e8e2d6"
            ],
            "cooler": [
              "#e9f2f6"
            ],
            "water": [
              "#4aa8ff"
            ],
            "glass": [
              "#9fd0d8"
            ],
            "panel": [
              "#fff4e0"
            ],
            "ceiling": [
              "#efebe3"
            ],
            "floor": [
              "#33373d",
              "#3a3f47"
            ]
          },
          "warehouse": {
            "upright": [
              "#1f5fb8",
              "#1a4f9c"
            ],
            "beam": [
              "#f07a12",
              "#e8680c"
            ],
            "deck": [
              "#9aa0a4"
            ],
            "box": [
              "#b5824a",
              "#c99456",
              "#9a6a3c",
              "#d6a868"
            ],
            "wrap": [
              "#dfe8ea"
            ],
            "pallet": [
              "#a9814f",
              "#8f6b40"
            ],
            "bench": [
              "#8a5e38"
            ],
            "leg": [
              "#2a2d31"
            ],
            "metal": [
              "#d7262e",
              "#7d858c"
            ],
            "panel": [
              "#fff1d6"
            ],
            "ceiling": [
              "#4a4d50"
            ]
          },
          "apartment": {
            "wall": [
              "#a8b89a",
              "#283a5a",
              "#e8c4b8",
              "#f1ece2"
            ],
            "accent_wall": [
              "#8c3b3b",
              "#2f5f66",
              "#d9a21b"
            ],
            "skirting": [
              "#f4f1ea"
            ],
            "sofa": [
              "#2f6b70",
              "#a8822e",
              "#8e4a30",
              "#4d4570"
            ],
            "cushion": [
              "#f2e4c8",
              "#e8c4b8"
            ],
            "wood": [
              "#9a6238",
              "#b8844f",
              "#6b4227"
            ],
            "wood2": [
              "#5a3825",
              "#7a4f2e",
              "#e8dccb"
            ],
            "leg": [
              "#1e1b18"
            ],
            "metal": [
              "#c9a25a"
            ],
            "sheet": [
              "#f4f1ea",
              "#e3e9f0"
            ],
            "blanket": [
              "#8c3b3b",
              "#2f5f66",
              "#d9a21b",
              "#5a7a3c"
            ],
            "pillow": [
              "#fbf8f0"
            ],
            "appliance": [
              "#eef0f0",
              "#2a2d31"
            ],
            "cabinet": [
              "#2f5f66",
              "#e8dccb",
              "#a8b89a"
            ],
            "counter": [
              "#1e1e20",
              "#efece6"
            ],
            "paper": [
              "#8c3b3b",
              "#2f7bff",
              "#d9a21b",
              "#3fae5a"
            ],
            "plant": [
              "#3f8a3a",
              "#5aa34a"
            ],
            "pot": [
              "#c0643a",
              "#e8e2d6"
            ],
            "chair": [
              "#1f6f78",
              "#b5532c"
            ],
            "screen": [
              "#0d0f12"
            ],
            "panel": [
              "#ffd29a"
            ],
            "ceiling": [
              "#f4efe6"
            ],
            "floor": [
              "#8a6a4e",
              "#94705a",
              "#7a5e48"
            ]
          },
          "shop": {
            "wall": [
              "#cfc9be"
            ],
            "accent_wall": [
              "#ff4fa0",
              "#1f6f78",
              "#ffc81e"
            ],
            "skirting": [
              "#1e1e20"
            ],
            "shelfback": [
              "#4f5861",
              "#5d5048"
            ],
            "metal": [
              "#9aa2a8",
              "#868e95"
            ],
            "product": [
              "#e8321e",
              "#1f6fe8"
            ],
            "product1": [
              "#ffc81e"
            ],
            "product2": [
              "#26b04a",
              "#ff6a10"
            ],
            "product3": [
              "#8a3fd0",
              "#f6f6f6"
            ],
            "product4": [
              "#12c0d4"
            ],
            "product5": [
              "#e0306e"
            ],
            "counter_body": [
              "#1f6f78",
              "#b5232e"
            ],
            "counter": [
              "#f4f1ea"
            ],
            "accent": [
              "#ff4fa0",
              "#4fe0ff"
            ],
            "wood": [
              "#c9a77a",
              "#8a6a4a"
            ],
            "wood2": [
              "#5e4a3a"
            ],
            "appliance": [
              "#e6eef2"
            ],
            "fridge_glow": [
              "#d9f2ff"
            ],
            "box": [
              "#b5824a",
              "#c99456",
              "#9a6a3c"
            ],
            "pallet": [
              "#a9814f"
            ],
            "paper": [
              "#f2f4f7",
              "#2f7bff",
              "#e2553f"
            ],
            "leg": [
              "#2a2d31"
            ],
            "screen": [
              "#0d0f12"
            ],
            "panel": [
              "#ffffff"
            ],
            "ceiling": [
              "#e8e5de"
            ],
            "floor": [
              "#958c80"
            ],
            "product_row": [
              "#fefdfb"
            ]
          },
          "lobby": {
            "wall": [
              "#e9e4d8"
            ],
            "accent_wall": [
              "#3fd0d0"
            ],
            "skirting": [
              "#1b1b1d"
            ],
            "reception": [
              "#1b1b1d",
              "#efece6"
            ],
            "marble": [
              "#efece6",
              "#e6dfd2"
            ],
            "accent": [
              "#c9a25a",
              "#1b1b1d"
            ],
            "wood": [
              "#4a3426",
              "#5a3825"
            ],
            "leg": [
              "#1b1b1d"
            ],
            "pot": [
              "#1b1b1d",
              "#c0643a"
            ],
            "plant": [
              "#3f8a3a",
              "#5aa34a"
            ],
            "plant2": [
              "#6bb34f"
            ],
            "sofa": [
              "#1f6f78"
            ],
            "cushion": [
              "#e8c4b8"
            ],
            "screen": [
              "#0d0f12"
            ],
            "panel": [
              "#fff6e6"
            ],
            "ceiling": [
              "#8a5a34"
            ],
            "floor": [
              "#9c968c"
            ]
          },
          "workshop": {
            "upright": [
              "#1f5fb8",
              "#1a4f9c"
            ],
            "beam": [
              "#f07a12",
              "#e8680c"
            ],
            "deck": [
              "#9aa0a4"
            ],
            "box": [
              "#b5824a",
              "#c99456",
              "#9a6a3c",
              "#d6a868"
            ],
            "wrap": [
              "#dfe8ea"
            ],
            "pallet": [
              "#a9814f",
              "#8f6b40"
            ],
            "bench": [
              "#8a5e38"
            ],
            "leg": [
              "#2a2d31"
            ],
            "metal": [
              "#d7262e",
              "#7d858c"
            ],
            "panel": [
              "#fff1d6"
            ],
            "ceiling": [
              "#4a4d50"
            ],
            "paper": [
              "#f2f4f7",
              "#2f7bff"
            ],
            "wood": [
              "#8a5e38"
            ]
          }
        },
        "tenants": {
          "labs": {
            "name": "Mirrsona Labs",
            "weight": {
              "default": 3,
              "hudson_yards": 5,
              "midtown_core": 2
            },
            "ceilingCell": null,
            "ceilingGlow": 0.05,
            "floorCell": "fabric",
            "palette": {
              "wall": [
                "#f2f0ea"
              ],
              "accent_wall": [
                "#1f8a8a",
                "#e2553f"
              ],
              "skirting": [
                "#1e2124"
              ],
              "floor": [
                "#33373d"
              ],
              "ceiling": [
                "#1c1d20"
              ],
              "laminate": [
                "#d8b98a"
              ],
              "leg": [
                "#1e2124"
              ],
              "chair": [
                "#2b2e33",
                "#3a3d42",
                "#2b2e33",
                "#d0742e",
                "#2b2e33",
                "#3a3d42",
                "#2b2e33",
                "#1f8a8a"
              ],
              "fabric": [
                "#3d7a7e",
                "#b38a3a",
                "#b0604c",
                "#7b9a6a",
                "#34476b"
              ],
              "panel": [
                "#ffe0b8"
              ]
            }
          },
          "law": {
            "name": "Ashgrove & Vale",
            "weight": {
              "default": 2,
              "midtown_core": 4
            },
            "ceilingCell": "slats",
            "ceilingGlow": 0.08,
            "floorCell": "fabric",
            "palette": {
              "wall": [
                "#e8dcc4"
              ],
              "accent_wall": [
                "#5a3825"
              ],
              "skirting": [
                "#5a3825"
              ],
              "floor": [
                "#5e1f2a"
              ],
              "ceiling": [
                "#6e5038"
              ],
              "laminate": [
                "#5a3825"
              ],
              "wood": [
                "#5a3825",
                "#6e4630"
              ],
              "leg": [
                "#2a1d16"
              ],
              "chair": [
                "#6b2420"
              ],
              "fabric": [
                "#1f4a3a"
              ],
              "metal": [
                "#c49a4c",
                "#5a3825"
              ],
              "metal_dark": [
                "#c49a4c"
              ],
              "panel": [
                "#ffcf8a"
              ]
            }
          },
          "trading": {
            "name": "Mirr Capital",
            "weight": {
              "default": 2,
              "midtown_core": 4,
              "hudson_yards": 3
            },
            "ceilingCell": null,
            "ceilingGlow": 0.2,
            "floorCell": "fabric",
            "palette": {
              "wall": [
                "#56606e"
              ],
              "accent_wall": [
                "#2f3a4f"
              ],
              "skirting": [
                "#111316"
              ],
              "floor": [
                "#1d2a44"
              ],
              "ceiling": [
                "#1c1d20"
              ],
              "laminate": [
                "#3a3e46"
              ],
              "leg": [
                "#1a1b1e"
              ],
              "chair": [
                "#2f3138",
                "#2f3138",
                "#3a3d42",
                "#c43b3b"
              ],
              "fabric": [
                "#3a4150",
                "#2f3a4f"
              ],
              "metal": [
                "#3a3d43"
              ],
              "panel": [
                "#eef4ff"
              ]
            }
          },
          "agency": {
            "name": "Inkhaus",
            "weight": {
              "default": 2,
              "industrial_west": 4,
              "queens_waterfront": 3
            },
            "ceilingCell": "acoustic",
            "ceilingGlow": 0.18,
            "floorCell": "slats",
            "palette": {
              "wall": [
                "#faf6ee"
              ],
              "accent_wall": [
                "#e0a526",
                "#2f4fd8"
              ],
              "skirting": [
                "#2a2d31"
              ],
              "floor": [
                "#b07a48"
              ],
              "ceiling": [
                "#f4f1ea"
              ],
              "laminate": [
                "#eceae4"
              ],
              "leg": [
                "#2a2d31"
              ],
              "chair": [
                "#3a3d42",
                "#2b2e33",
                "#3a3d42",
                "#c9962e",
                "#3a3d42",
                "#2b2e33",
                "#3a3d42",
                "#2f4fd8"
              ],
              "fabric": [
                "#b38a3a",
                "#34476b",
                "#8a8070"
              ],
              "panel": [
                "#ffb46b"
              ]
            }
          },
          "records": {
            "name": "Bureau of Civic Records",
            "weight": {
              "default": 1,
              "roosevelt": 3,
              "queens_lowrise": 2
            },
            "ceilingCell": "acoustic",
            "ceilingGlow": 0.16,
            "floorCell": "laminate",
            "palette": {
              "wall": [
                "#e9e4d2"
              ],
              "accent_wall": [
                "#8fa39a"
              ],
              "skirting": [
                "#6b7253"
              ],
              "floor": [
                "#b9b29f"
              ],
              "ceiling": [
                "#e6e4dc"
              ],
              "laminate": [
                "#c9ccce"
              ],
              "leg": [
                "#7d858c"
              ],
              "chair": [
                "#6b7253"
              ],
              "fabric": [
                "#6b7253",
                "#8fa39a"
              ],
              "metal": [
                "#7d858c"
              ],
              "panel": [
                "#e8f5e4"
              ]
            }
          }
        },
        "dress": {
          "labs": [
            [
              "keyboard",
              0.9
            ],
            [
              "mug",
              0.5
            ],
            [
              "papers",
              0.3
            ],
            [
              "whiteboard",
              0.4
            ],
            [
              "sign",
              1
            ]
          ],
          "law": [
            [
              "keyboard",
              0.7
            ],
            [
              "papers",
              0.6
            ],
            [
              "diploma",
              0.5
            ],
            [
              "sign",
              1
            ],
            [
              "lamp",
              0.6
            ]
          ],
          "trading": [
            [
              "keyboard",
              1
            ],
            [
              "mug",
              0.3
            ],
            [
              "ticker",
              1
            ],
            [
              "clock",
              0.5
            ],
            [
              "sign",
              1
            ]
          ],
          "agency": [
            [
              "keyboard",
              0.6
            ],
            [
              "mug",
              0.6
            ],
            [
              "poster",
              0.6
            ],
            [
              "moodboard",
              0.4
            ],
            [
              "sign",
              1
            ],
            [
              "lamp",
              0.4
            ]
          ],
          "records": [
            [
              "keyboard",
              0.7
            ],
            [
              "papers",
              0.8
            ],
            [
              "queue",
              1
            ],
            [
              "sign",
              1
            ]
          ],
          "apartment": [
            [
              "rug",
              1
            ],
            [
              "lamp",
              0.9
            ],
            [
              "curtain",
              0.8
            ],
            [
              "tv",
              0.7
            ],
            [
              "sconce2",
              0.5
            ],
            [
              "poster",
              0.6
            ]
          ],
          "shop": [
            [
              "neon",
              0.8
            ],
            [
              "open",
              1
            ]
          ],
          "warehouse": [
            [
              "floorline",
              1
            ],
            [
              "exit",
              1
            ],
            [
              "firecab",
              0.6
            ]
          ],
          "workshop": [
            [
              "exit",
              1
            ],
            [
              "firecab",
              0.6
            ]
          ],
          "lobby": [
            [
              "sign",
              1
            ],
            [
              "inlay",
              1
            ],
            [
              "benchrug",
              0.6
            ]
          ]
        },
        "dressColors": {
          "keyboard": [
            "#1c1e22"
          ],
          "mug": [
            "#e2553f",
            "#f2f0ea",
            "#1f8a8a",
            "#ffc93c",
            "#2f4fd8"
          ],
          "papers": [
            "#f4f2ec"
          ],
          "whiteboard": [
            "#f4f6f8"
          ],
          "frame": [
            "#2a1d16",
            "#c49a4c"
          ],
          "poster": [
            "#e2553f",
            "#2f4fd8",
            "#ffc93c",
            "#1f8a8a",
            "#ff6fb0"
          ],
          "moodboard": [
            "#c8a27a"
          ],
          "clock": [
            "#0d0f12"
          ],
          "tv": [
            "#0d0f12"
          ],
          "sconce": [
            "#ffd29a"
          ],
          "neon": [
            "#ff4fa0",
            "#4fe0ff"
          ],
          "firecab": [
            "#d7262e"
          ],
          "exit": [
            "#1fbf5a"
          ],
          "floorline": [
            "#f2c200"
          ],
          "rug": [
            "#8c3b3b",
            "#2f5f66"
          ],
          "sign": [
            "#0d0f12"
          ],
          "lamp": [
            "#ffd29a"
          ],
          "inlay": [
            "#c9a25a"
          ],
          "curtain": [
            "#c9b8a0",
            "#8c3b3b",
            "#2f5f66",
            "#d9c9a8"
          ]
        },
        "dressMax": {
          "whiteboard": 4,
          "diploma": 4,
          "poster": 5,
          "moodboard": 3,
          "clock": 2,
          "tv": 2,
          "sconce": 6,
          "sconce2": 4,
          "neon": 5,
          "firecab": 3
        },
        "glowOf": {
          "fridge_glow": 0.9
        },
        "lights": {
          "lampRadius": 2.2,
          "lampGain": 2.6,
          "sconceRadius": 1.6,
          "sconceGain": 1.8,
          "lampColor": "#ffd29a"
        },
        "cells": {
          "names": [
            "oak",
            "walnut",
            "birch",
            "laminate",
            "fabric",
            "leather",
            "steel",
            "chrome",
            "cardboard",
            "books",
            "paper",
            "leaves",
            "rug",
            "acoustic",
            "slats",
            "cork"
          ],
          "tile": [
            0.9,
            0.7,
            0.9,
            0.6,
            0.25,
            0.4,
            0.6,
            0.8,
            0.5,
            0.45,
            0.5,
            0.45,
            1.2,
            1.2,
            0.7,
            0.4
          ],
          "own": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            1,
            0,
            1,
            1,
            0,
            0,
            0
          ]
        },
        "cellOf": {
          "laminate": "birch",
          "cap": "laminate",
          "leg": "steel",
          "metal": "steel",
          "metal_dark": "steel",
          "fabric": "fabric",
          "chair": "fabric",
          "wood": "walnut",
          "wood2": "oak",
          "paper": "books",
          "plant": "leaves",
          "box": "cardboard",
          "pallet": "oak",
          "upright": "steel",
          "beam": "steel",
          "deck": "steel",
          "bench": "oak",
          "sofa": "fabric",
          "cushion": "fabric",
          "sheet": "fabric",
          "blanket": "fabric",
          "pillow": "fabric",
          "cabinet": "laminate",
          "counter": "laminate",
          "shelfback": "laminate",
          "appliance": "chrome",
          "cooler": "chrome",
          "reception": "laminate",
          "counter_body": "laminate",
          "screen": "screen",
          "office:paper": "books",
          "glass": "glass",
          "product_row": "products",
          "lobby:wood": "leather"
        },
        "shell": {
          "ceilingThick": 0.01,
          "ceilingGap": 0.004,
          "glow": {
            "default": 0.2,
            "office": 0.16,
            "warehouse": 0.14,
            "workshop": 0.14,
            "apartment": 0.12,
            "shop": 0.22,
            "lobby": 0.2
          },
          "liner": {
            "office": true,
            "apartment": true,
            "shop": true,
            "lobby": true
          },
          "accentChance": {
            "default": 0.5,
            "lobby": 1
          },
          "skirting": 0.1,
          "inset": 0.02,
          "windowBand": 1.3,
          "ceilingCell": {
            "office": "acoustic",
            "shop": "acoustic",
            "lobby": "slats"
          },
          "bakeRadius": {
            "default": 1.8,
            "warehouse": 4,
            "workshop": 4,
            "apartment": 2.2,
            "lobby": 2.4
          },
          "floor": {
            "office": true,
            "apartment": true,
            "lobby": true,
            "shop": true
          },
          "floorCell": {
            "office": "fabric",
            "apartment": "slats",
            "lobby": "laminate",
            "shop": "acoustic"
          },
          "accentGlow": {
            "lobby": 1.4
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
    "levels/manhattan.json": {
      "id": "manhattan",
      "name": "ニューヨーク",
      "generator": "nyc",
      "data": "levels/nyc/nyc.json",
      "core": "levels/nyc/core.bin",
      "bounds": {
        "minX": -2900,
        "maxX": 3100,
        "minZ": -3000,
        "maxZ": 9800
      },
      "seed": 1,
      "chunkSize": 128,
      "superChunk": 512,
      "skylineGroup": 1024,
      "maxOverhang": 64,
      "waterY": -2,
      "bedY": -14,
      "curbH": 0.15,
      "sidewalk": 4,
      "water": {
        "inlandDepth": 2.5
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
        "parkCell": 32,
        "prismMode": "exact",
        "flightCollider": "center",
        "colliderStep": [
          1.5,
          4
        ],
        "coarseInset": 0.25,
        "solidStepMin": 0.5,
        "colliderInsetStepMin": 1,
        "colliderMinArea": 1,
        "colliderRoundInset": true,
        "prismCellEdges": 24
      },
      "support": {
        "pad": 0.5,
        "roofExtra": 1.2,
        "deckExtra": 0.3
      },
      "skylineMinH": 40,
      "suppressGids": [
        16920
      ],
      "stairs": [
        {
          "id": "tkts",
          "gid": 30106,
          "steps": 16,
          "dir": [
            0,
            -1
          ],
          "mat": "concrete",
          "_note": "TKTS の赤い階段（ダフィー・スクエア）: 片を消して 16 段の WALK の箱（citygen_nyc.js _initStairs、上がる向き -z = One Times Square から離れる）。見た目は timessq.js が同じ city.stairs.tkts から"
        }
      ],
      "facades": {
        "_note": "M1: 外壁は今ある v1 の材質。様式（core PRT の style）→ 候補、tallMinH m 以上は tall（keepStyle の様式は除く）、gid のハッシュで選ぶ。glass_tower になった片が glassMinH m 未満か glassMaxFloors 階以下なら small（core だけ = 近景と遠景で同じ）",
        "default": [
          "concrete_win",
          "office_stone"
        ],
        "byStyle": {
          "generic": [
            "concrete_win",
            "office_stone",
            "brick_brown"
          ],
          "brownstone": [
            "brick_brown"
          ],
          "prewar_brick": [
            "brick_brown",
            "brick_red"
          ],
          "cast_iron": [
            "limestone_win",
            "office_stone"
          ],
          "artdeco_limestone": [
            "limestone_win",
            "office_stone"
          ],
          "modern_glass": [
            "glass_tower"
          ],
          "postwar": [
            "concrete_win",
            "office_stone"
          ],
          "industrial": [
            "brick_red",
            "concrete_win"
          ],
          "civic_stone": [
            "limestone_win"
          ],
          "house": [
            "brick_red",
            "brick_brown"
          ],
          "small": [
            "brick_brown",
            "concrete_win"
          ],
          "terminal": [
            "limestone_win"
          ]
        },
        "tallMinH": 120,
        "tall": [
          "glass_tower",
          "office_stone",
          "glass_tower",
          "limestone_win"
        ],
        "glassMinH": 15,
        "glassMaxFloors": 2,
        "small": [
          "concrete_win",
          "brick_brown"
        ],
        "keepStyle": [
          "artdeco_limestone",
          "civic_stone",
          "terminal"
        ]
      },
      "plinthMats": [
        "sidewalk",
        "terrazzo",
        "sidewalk",
        "curb"
      ],
      "rails": {
        "_note": "nyc-complete NC3 (citygen_nyc.js _initEl, core RLEL): el = decks / columns / beams of the elevated and above-grade rail (width, thick m; columns every colStep m, colW m square, off the carriageways within colReach m, colLat m steps, shifted along by colShift, else a bent over the road (bentReach, beam bottom >= bentClear) or a column on a low roof; embankment below embankH m clearance; deck narrowed off buildings; end wall at the map edge), platforms (el station platforms, platThick); portal = U-wall cut (ramps = cut lengths tried, depth m) + stub m tunnel at each RPRT portal; cut-and-cover (repair 3): a mapped road strip (curb + sidewalk + coverMargin m) over the cut is roofed at street level, the cut opens only on the longest road-free stretch (>= openMin m, floor grade <= coverGrade, coverHead m under the cover at its start, -depth coverFlat m before the end wall), else the portal is covered whole (not built); repair 4: only a carriageway (cls 1..12 inside the curbs + cwMargin) or a road / walkway crossing the cut (|cos| < alongCos, curb + sidewalk + coverMargin) blocks it, sidewalks / walkways alongside are fine, a carriageway alongside narrows that side of the cut by up to shrinkMax m (median portal, track width >= minInner); with no stretch in the portal, a termLen m cut before the portal on the surface track (up to backMax m back) leads under the road (termA); else covered whole and a surface track that ends there stops termGap m before the kerb at a low wall termH m + dark grate (no collision, drawing layer); tunnel lines just above grade before a built portal (mouthBack m) are drawn at grade",
        "el": {
          "width": 4.6,
          "thick": 1.4,
          "minY": 0.3,
          "deckTol": 1,
          "sample": 3,
          "pieceMax": 20,
          "solidClear": 3.5,
          "minRun": 2,
          "colStep": 15,
          "colW": 1.2,
          "colReach": 14,
          "colLat": 1,
          "colMerge": 3,
          "colMinH": 0.5,
          "colRoad": 0.4,
          "colBld": 0.6,
          "colTrack": 2.2,
          "colEnt": 1,
          "beamH": 0.9,
          "beamW": 0.9,
          "mat": "curb",
          "colMat": "curb",
          "platThick": 1,
          "platMat": "sidewalk",
          "spawnClear": 1.6,
          "lowDeck": 2.2,
          "carClear": 1
        },
        "portal": {
          "ramp": 60,
          "ramps": [
            60,
            45,
            30
          ],
          "stub": 40,
          "depth": 6,
          "wall": 0.5,
          "rail": 1.1,
          "roof": 1,
          "ceil": 0.15,
          "minWidth": 6,
          "mergeDeg": 15,
          "mergeAlong": 15,
          "mergeGap": 2,
          "sample": 3,
          "deckClear": 5,
          "mat": "curb",
          "stubMat": "tunnelDark",
          "floorMat": "gravel_roof",
          "stubFloorMat": "tunnelDark",
          "floorT": 1,
          "coverMargin": 1,
          "coverHead": 2.2,
          "coverGrade": 0.35,
          "openMin": 8,
          "coverFlat": 5,
          "cwMargin": 0.3,
          "alongCos": 0.8,
          "shrinkMax": 2,
          "minInner": 4.4,
          "backMax": 30,
          "termLen": 15,
          "termMin": 8,
          "termGap": 1.5,
          "termT": 0.6,
          "termH": 1,
          "grateH": 0.03,
          "mouthClear": 0.5,
          "mouthBack": 100,
          "stopNear": 3,
          "stopW": 3.2
        }
      },
      "underground": {
        "_note": "nyc-complete NC6: subway stations (www/js/stations.js MR.Stations). rooms = mezzanines (axis-aligned rect, floor y, height h); halls = platforms on one level (core STAT platforms by near point; bed = platform top - bedBelow; stub m tunnels both ends); stairs from a room edge (at) along the platform axis (dir); ents = core STAT entrances by near point = pit + stair + covered stair + landing + corridor path to the room; links = corridors between rooms; fare = turnstile line (1.0 m boxes, gate = walk-through opening). Times Sq: the 7 keeps the data depth (-31 m, it passes under the 1/2/3 hall). ents[].turn (deg) rotates the STAT entrance pit about its centre (layout override, core unchanged) so the open stair end faces the sidewalk: 126 and 127 opened toward the roadway. NC7 keys: rooms[].rot (deg, rotates the rect about its centre: u = (cos, sin); fare lines only in unrotated rooms), plats[].set {x, z, yaw (deg, u = (sin, cos) like STAT), hl, hw, y, flags} overrides the matched STAT platform (no near = a platform the data lacks, i < 0), plats[].y = depth fix, halls[].extraTracks (lateral m from the first platform's axis), halls[].stubs [a, b] (stub per end), halls[].h, ents[].set {x, z, yaw, w, l} = an entrance the data could not place (i < 0). NC7 depth / data decisions (core STAT and stations.json unchanged): Times Sq S at its real site under 42 St between 7 Av and Broadway (data platform 120 m east), y -9.5 under the S mezzanine; 7 at Times Sq platform 65 (9 Av) and at GCT platform 57 (Madison Av) are 14 m wide one-track area pieces of the tail / unbuilt 10 Av shell, not built; GCT has no S platform in the data (synthetic island under 42 St between Vanderbilt and Park, y -10); Herald Sq B/D/F/M 76 / 77 at -20.76 / -23 levelled to -21 and 76 extended north to the 77 end (574); shallow platforms under a mezzanine moved from -7 (rail level x 8 m) to -10 (Penn 1/2/3, Fulton 2/3) - the real stations have a mezzanine above; Union Sq 4/5/6 has no platform in the data (synthetic side platforms on the straight part of the Lexington curve, y -13.5, 4 tracks), L 116 / 117 / 118 (-9.89 / -15.2 / -19.47) levelled to -20 under the Lexington, 116 moved 1.2 m onto the 117 track line; Fulton J/Z 186 / 187 extended to 110 m (data 27 m), 187 hw 7 -> 3 (merged polygon); Fulton has 1 placed MTA entrance, 2 layout entrances (set) on validated sidewalk spots. The GCT concourse link is not built: the concourse floor is a ported landmark box, not a plinth the pit hook can cut. NC7 fix: axis-aligned entrance pits snap sideways to the 1 m grid cell centre when > entSnap (0.3) m off (the 1.8 m stair is walkable for the 0.45 m enemy walk graph only on the cell centre line); the Fulton mezz fare line moved 50 -> 52.5 (the layout entrance stair foot at x 48.6 was a dead end 1.4 m before it). NC7 paid / unpaid: every entrance lands on the unpaid side and every platform stair on the paid side; fare[].span [a0, a1] = a partial line (lines combine into a paid pen around stair tops: Times Sq notch for 126, Union Sq SW / SE pens, Fulton J/Z pen), fare[] without gate = no service gate; stairs[].off (m along the platform's v = (-uz, ux)) + w 2.0 (Penn 80 / 81) / 2.2 (Union Sq 4/5/6) on the narrow side platforms leave a walkway beside the stair. ents[].snap +1 / -1 picks the upper / lower grid cell centre for the pit snap (117, 241: the nearer one clipped a building / the open end left the sidewalk). Union Sq 242 now lands in the mezzanine (the BMT room is paid), Penn 156 reaches the south (unpaid) half, the Times Sq 7 / A/C/E link enters the A/C/E room on its paid side, the GCT S corridor leaves the S mezzanine on its paid side.",
        "enabled": true,
        "layouts": [
          {
            "id": "times_sq",
            "near": [
              -926,
              54
            ],
            "ja": "タイムズスクエア–42丁目",
            "rooms": [
              {
                "id": "mezz",
                "rect": [
                  -908,
                  88,
                  -796,
                  112
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "m7",
                "rect": [
                  -962,
                  78,
                  -948,
                  108
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "s",
                "rect": [
                  -882,
                  -10,
                  -846,
                  4
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "ace",
                "rect": [
                  -1190,
                  40,
                  -1150,
                  70
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "ace_n",
                "rect": [
                  -1180,
                  -122,
                  -1145,
                  -100
                ],
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "irt",
                "lines": "1 2 3",
                "plats": [
                  {
                    "near": [
                      -904,
                      100
                    ],
                    "stairs": [
                      {
                        "at": [
                          -903.9,
                          88
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      -890,
                      110
                    ],
                    "stairs": [
                      {
                        "at": [
                          -889.9,
                          88
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "bmt",
                "lines": "N Q R W",
                "plats": [
                  {
                    "near": [
                      -802,
                      116
                    ],
                    "stairs": [
                      {
                        "at": [
                          -803,
                          112
                        ],
                        "dir": 1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      -814.5,
                      123.5
                    ],
                    "stairs": [
                      {
                        "at": [
                          -817.7,
                          112
                        ],
                        "dir": 1,
                        "room": "mezz"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "flushing",
                "lines": "7",
                "plats": [
                  {
                    "near": [
                      -906,
                      83
                    ],
                    "stairs": [
                      {
                        "at": [
                          -948,
                          83.3
                        ],
                        "dir": 1,
                        "room": "m7",
                        "t": 0.8
                      }
                    ]
                  }
                ]
              },
              {
                "id": "shuttle",
                "lines": "S",
                "plats": [
                  {
                    "near": [
                      -743.5,
                      -1.4
                    ],
                    "set": {
                      "x": -862,
                      "z": -3,
                      "yaw": 90,
                      "hl": 35,
                      "y": -9.5
                    },
                    "stairs": [
                      {
                        "at": [
                          -846,
                          -3
                        ],
                        "dir": 1,
                        "room": "s"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "ace",
                "lines": "A C E",
                "plats": [
                  {
                    "near": [
                      -1172.5,
                      102.3
                    ],
                    "stairs": [
                      {
                        "at": [
                          -1172.5,
                          70
                        ],
                        "dir": 1,
                        "room": "ace"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "ace_n",
                "lines": "A C E",
                "plats": [
                  {
                    "near": [
                      -1162.3,
                      -146.8
                    ],
                    "stairs": [
                      {
                        "at": [
                          -1162.3,
                          -122
                        ],
                        "dir": -1,
                        "room": "ace_n"
                      }
                    ]
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  -867.4,
                  92.8
                ],
                "room": "mezz"
              },
              {
                "near": [
                  -883.5,
                  93
                ],
                "room": "mezz",
                "turn": 90
              },
              {
                "near": [
                  -811.5,
                  172.2
                ],
                "room": "mezz",
                "path": [
                  [
                    -840,
                    172.2
                  ],
                  [
                    -840,
                    109
                  ]
                ],
                "snap": -1
              },
              {
                "near": [
                  -829.4,
                  155.6
                ],
                "room": "mezz",
                "path": [
                  [
                    -821.8,
                    162
                  ],
                  [
                    -840,
                    162
                  ]
                ]
              },
              {
                "near": [
                  -825.2,
                  19.8
                ],
                "room": "mezz",
                "turn": 90,
                "path": [
                  [
                    -825.2,
                    30
                  ],
                  [
                    -845,
                    30
                  ],
                  [
                    -845,
                    91
                  ]
                ]
              },
              {
                "near": [
                  -1198.6,
                  -13.3
                ],
                "room": "ace",
                "turn": 180,
                "path": [
                  [
                    -1165,
                    -13.3
                  ]
                ]
              },
              {
                "near": [
                  -1191.7,
                  -78.7
                ],
                "room": "ace",
                "path": [
                  [
                    -1165,
                    -78.7
                  ]
                ]
              }
            ],
            "links": [
              {
                "room": "mezz",
                "path": [
                  [
                    -952,
                    104
                  ],
                  [
                    -904,
                    104
                  ]
                ],
                "w": 4,
                "h": 3.2
              },
              {
                "room": "mezz",
                "path": [
                  [
                    -875,
                    4
                  ],
                  [
                    -875,
                    89
                  ]
                ]
              },
              {
                "room": "mezz",
                "path": [
                  [
                    -962,
                    92
                  ],
                  [
                    -1100,
                    92
                  ],
                  [
                    -1100,
                    66
                  ],
                  [
                    -1150,
                    66
                  ]
                ],
                "w": 4,
                "h": 3.2
              },
              {
                "room": "ace",
                "path": [
                  [
                    -1165,
                    40
                  ],
                  [
                    -1165,
                    -100
                  ]
                ]
              }
            ],
            "fare": [
              {
                "room": "mezz",
                "axis": "x",
                "at": -886,
                "span": [
                  96.35,
                  112
                ],
                "gate": [
                  99,
                  101
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": -886,
                "span": [
                  88,
                  90.85
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 90.7,
                "span": [
                  -892.15,
                  -885.85
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 96.5,
                "span": [
                  -892.15,
                  -885.85
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": -892,
                "span": [
                  90.55,
                  96.65
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": -830,
                "gate": [
                  99,
                  101
                ]
              },
              {
                "room": "m7",
                "axis": "z",
                "at": 95,
                "gate": [
                  -956,
                  -954
                ]
              },
              {
                "room": "s",
                "axis": "x",
                "at": -858,
                "gate": [
                  -4,
                  -2
                ]
              },
              {
                "room": "ace",
                "axis": "z",
                "at": 62,
                "gate": [
                  -1176,
                  -1174
                ]
              },
              {
                "room": "ace_n",
                "axis": "z",
                "at": -110,
                "gate": [
                  -1160,
                  -1158
                ]
              }
            ]
          },
          {
            "id": "gct",
            "near": [
              31,
              0
            ],
            "ja": "グランド・セントラル–42丁目",
            "rooms": [
              {
                "id": "lex",
                "rect": [
                  61.8,
                  -16.06,
                  101.8,
                  15.94
                ],
                "rot": 136.7,
                "y": -5,
                "h": 3.8
              },
              {
                "id": "lex7",
                "rect": [
                  170,
                  4,
                  196,
                  20
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "m7",
                "rect": [
                  206,
                  -6,
                  222,
                  16
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "cz",
                "rect": [
                  118,
                  2,
                  142,
                  18
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "ms",
                "rect": [
                  -45,
                  -10,
                  -20,
                  4
                ],
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "lex",
                "lines": "4 5 6",
                "plats": [
                  {
                    "near": [
                      76.5,
                      -5.7
                    ],
                    "stairs": [
                      {
                        "at": [
                          61.94,
                          8.02
                        ],
                        "dir": 1,
                        "room": "lex"
                      },
                      {
                        "at": [
                          91.06,
                          -19.42
                        ],
                        "dir": -1,
                        "room": "lex"
                      }
                    ]
                  },
                  {
                    "near": [
                      80.4,
                      11.8
                    ],
                    "stairs": [
                      {
                        "at": [
                          72.5,
                          19.24
                        ],
                        "dir": 1,
                        "room": "lex"
                      },
                      {
                        "at": [
                          101.6,
                          -8.35
                        ],
                        "dir": -1,
                        "room": "lex"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "flushing",
                "lines": "7",
                "plats": [
                  {
                    "near": [
                      174.9,
                      -0.9
                    ],
                    "stairs": [
                      {
                        "at": [
                          206,
                          -0.9
                        ],
                        "dir": 1,
                        "room": "m7",
                        "t": 0.8
                      }
                    ]
                  }
                ]
              },
              {
                "id": "shuttle",
                "lines": "S",
                "stubs": [
                  50,
                  40
                ],
                "plats": [
                  {
                    "set": {
                      "x": -30,
                      "z": -3,
                      "yaw": 90,
                      "hl": 30,
                      "hw": 4,
                      "y": -10,
                      "flags": 3
                    },
                    "stairs": [
                      {
                        "at": [
                          -20,
                          -3
                        ],
                        "dir": 1,
                        "room": "ms"
                      }
                    ]
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  190.4,
                  12.3
                ],
                "room": "lex7"
              },
              {
                "near": [
                  174.1,
                  11.9
                ],
                "room": "lex7"
              },
              {
                "near": [
                  -190.7,
                  -14.7
                ],
                "room": "ms",
                "path": [
                  [
                    -60,
                    -14.7
                  ],
                  [
                    -60,
                    2
                  ],
                  [
                    -45,
                    2
                  ]
                ]
              }
            ],
            "links": [
              {
                "room": "lex7",
                "path": [
                  [
                    196,
                    8
                  ],
                  [
                    206,
                    8
                  ]
                ]
              },
              {
                "room": "lex7",
                "path": [
                  [
                    170,
                    10
                  ],
                  [
                    142,
                    10
                  ]
                ]
              },
              {
                "room": "cz",
                "path": [
                  [
                    118,
                    10
                  ],
                  [
                    102.8,
                    7.64
                  ],
                  [
                    94.6,
                    -1.1
                  ]
                ]
              },
              {
                "room": "ms",
                "path": [
                  [
                    -20,
                    -7
                  ],
                  [
                    58,
                    -7
                  ],
                  [
                    70.5,
                    -0.4
                  ]
                ]
              }
            ],
            "fare": [
              {
                "room": "m7",
                "axis": "z",
                "at": 4,
                "gate": [
                  213,
                  215
                ]
              },
              {
                "room": "cz",
                "axis": "x",
                "at": 130,
                "gate": [
                  9,
                  11
                ]
              },
              {
                "room": "ms",
                "axis": "z",
                "at": -1,
                "gate": [
                  -40,
                  -38
                ]
              }
            ]
          },
          {
            "id": "herald_sq",
            "near": [
              -621,
              659
            ],
            "ja": "34丁目–ヘラルド・スクエア",
            "rooms": [
              {
                "id": "mezz",
                "rect": [
                  -652,
                  610,
                  -596,
                  700
                ],
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "bmt",
                "lines": "N Q R W",
                "plats": [
                  {
                    "near": [
                      -610.7,
                      677.7
                    ],
                    "stairs": [
                      {
                        "at": [
                          -602.1,
                          700
                        ],
                        "dir": 1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      -625.5,
                      678.1
                    ],
                    "stairs": [
                      {
                        "at": [
                          -617,
                          700
                        ],
                        "dir": 1,
                        "room": "mezz"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "ind",
                "lines": "B D F M",
                "plats": [
                  {
                    "near": [
                      -613.9,
                      677.5
                    ],
                    "y": -21,
                    "stairs": [
                      {
                        "at": [
                          -613.9,
                          610
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      -628.1,
                      642.5
                    ],
                    "set": {
                      "z": 629.5,
                      "hl": 55.5
                    },
                    "y": -21,
                    "stairs": [
                      {
                        "at": [
                          -628.1,
                          610
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  -593.6,
                  653.4
                ],
                "room": "mezz"
              },
              {
                "near": [
                  -653.8,
                  653.7
                ],
                "room": "mezz"
              },
              {
                "near": [
                  -668,
                  627.7
                ],
                "room": "mezz",
                "path": [
                  [
                    -650,
                    627.7
                  ]
                ]
              }
            ],
            "links": [],
            "fare": [
              {
                "room": "mezz",
                "axis": "z",
                "at": 690,
                "gate": [
                  -612,
                  -610
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 620,
                "gate": [
                  -640,
                  -638
                ]
              }
            ]
          },
          {
            "id": "penn_123",
            "near": [
              -894,
              718
            ],
            "ja": "34丁目–ペン駅（1・2・3）",
            "rooms": [
              {
                "id": "mezz",
                "rect": [
                  -915,
                  640,
                  -876,
                  660
                ],
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "irt",
                "lines": "1 2 3",
                "plats": [
                  {
                    "near": [
                      -895.9,
                      679.3
                    ],
                    "y": -10,
                    "stairs": [
                      {
                        "at": [
                          -895.9,
                          660
                        ],
                        "dir": 1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      -885.2,
                      647.9
                    ],
                    "y": -10,
                    "stairs": [
                      {
                        "at": [
                          -885.2,
                          660
                        ],
                        "dir": 1,
                        "room": "mezz",
                        "w": 2,
                        "off": -0.45
                      }
                    ]
                  },
                  {
                    "near": [
                      -906.4,
                      648.6
                    ],
                    "y": -10,
                    "stairs": [
                      {
                        "at": [
                          -906.4,
                          660
                        ],
                        "dir": 1,
                        "room": "mezz",
                        "w": 2,
                        "off": 0.45
                      }
                    ]
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  -876.8,
                  625.2
                ],
                "room": "mezz",
                "path": [
                  [
                    -884.4,
                    641
                  ]
                ]
              },
              {
                "near": [
                  -916.1,
                  625.1
                ],
                "room": "mezz",
                "path": [
                  [
                    -908.5,
                    641
                  ]
                ]
              },
              {
                "near": [
                  -877.2,
                  716
                ],
                "room": "mezz",
                "path": [
                  [
                    -884.8,
                    705
                  ],
                  [
                    -872,
                    705
                  ],
                  [
                    -872,
                    645
                  ],
                  [
                    -876,
                    645
                  ]
                ]
              }
            ],
            "links": [],
            "fare": [
              {
                "room": "mezz",
                "axis": "z",
                "at": 650,
                "gate": [
                  -892,
                  -890
                ]
              }
            ]
          },
          {
            "id": "union_sq",
            "near": [
              -23,
              2179
            ],
            "ja": "14丁目–ユニオン・スクエア",
            "rooms": [
              {
                "id": "mezz",
                "rect": [
                  -40,
                  2196,
                  45,
                  2240
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "bmt",
                "rect": [
                  -66.9,
                  2139,
                  -50.9,
                  2167
                ],
                "rot": 70.86,
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "bmt",
                "lines": "N Q R W",
                "plats": [
                  {
                    "near": [
                      -64.5,
                      2116.8
                    ],
                    "stairs": [
                      {
                        "at": [
                          -55.3,
                          2143.3
                        ],
                        "dir": -1,
                        "room": "bmt"
                      }
                    ]
                  },
                  {
                    "near": [
                      -76.1,
                      2121.1
                    ],
                    "stairs": [
                      {
                        "at": [
                          -67,
                          2147.4
                        ],
                        "dir": -1,
                        "room": "bmt"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "lex",
                "lines": "4 5 6",
                "extraTracks": [
                  -7.7,
                  -12.1
                ],
                "plats": [
                  {
                    "set": {
                      "x": 2.9,
                      "z": 2158.9,
                      "yaw": 23.2,
                      "hl": 38,
                      "hw": 1.8,
                      "y": -13.5,
                      "flags": 1
                    },
                    "stairs": [
                      {
                        "at": [
                          18.8,
                          2196
                        ],
                        "dir": -1,
                        "room": "mezz",
                        "w": 2.2,
                        "off": 0.55
                      }
                    ]
                  },
                  {
                    "set": {
                      "x": 21.1,
                      "z": 2151.1,
                      "yaw": 23.2,
                      "hl": 38,
                      "hw": 1.8,
                      "y": -13.5,
                      "flags": 2
                    },
                    "stairs": [
                      {
                        "at": [
                          40.4,
                          2196
                        ],
                        "dir": -1,
                        "room": "mezz",
                        "w": 2.2,
                        "off": -0.55
                      }
                    ]
                  }
                ]
              },
              {
                "id": "canarsie",
                "lines": "L",
                "plats": [
                  {
                    "near": [
                      -34.9,
                      2218.6
                    ],
                    "y": -20,
                    "stairs": [
                      {
                        "at": [
                          -40,
                          2218.6
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      116.9,
                      2211.2
                    ],
                    "set": {
                      "z": 2210
                    },
                    "y": -20
                  },
                  {
                    "near": [
                      -156.9,
                      2227
                    ],
                    "y": -20
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  -48.3,
                  2232.4
                ],
                "room": "mezz",
                "path": [
                  [
                    -38,
                    2232.4
                  ]
                ]
              },
              {
                "near": [
                  28,
                  2226
                ],
                "room": "mezz"
              },
              {
                "near": [
                  12.6,
                  2225.9
                ],
                "room": "mezz",
                "snap": 1
              },
              {
                "near": [
                  -85.1,
                  2189.1
                ],
                "room": "mezz",
                "path": [
                  [
                    -70,
                    2189.5
                  ],
                  [
                    -70,
                    2238
                  ],
                  [
                    -40,
                    2238
                  ]
                ]
              }
            ],
            "links": [
              {
                "room": "bmt",
                "path": [
                  [
                    -55,
                    2158
                  ],
                  [
                    -33,
                    2188
                  ],
                  [
                    -33,
                    2201
                  ]
                ]
              }
            ],
            "fare": [
              {
                "room": "mezz",
                "axis": "x",
                "at": -28,
                "span": [
                  2196,
                  2224.15
                ],
                "gate": [
                  2206,
                  2208
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 2224,
                "span": [
                  -40,
                  -27.85
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 2202,
                "span": [
                  11.85,
                  45
                ],
                "gate": [
                  30,
                  32
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": 12,
                "span": [
                  2196,
                  2202.15
                ]
              }
            ]
          },
          {
            "id": "fulton",
            "near": [
              33,
              5318
            ],
            "ja": "フルトン・ストリート",
            "rooms": [
              {
                "id": "mezz",
                "rect": [
                  15,
                  5288,
                  70,
                  5318
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "lex",
                "rect": [
                  -125,
                  5280,
                  -86,
                  5298
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "lexs",
                "rect": [
                  -125,
                  5418,
                  -94,
                  5442
                ],
                "y": -5,
                "h": 3.8
              },
              {
                "id": "m23",
                "rect": [
                  150,
                  5300,
                  172,
                  5320
                ],
                "y": -5,
                "h": 3.8
              }
            ],
            "halls": [
              {
                "id": "ac",
                "lines": "A C",
                "plats": [
                  {
                    "near": [
                      32.9,
                      5300.5
                    ],
                    "stairs": [
                      {
                        "at": [
                          70,
                          5303.6
                        ],
                        "dir": 1,
                        "room": "mezz",
                        "t": 0.8
                      }
                    ]
                  }
                ]
              },
              {
                "id": "jz",
                "lines": "J Z",
                "plats": [
                  {
                    "near": [
                      36,
                      5312.3
                    ],
                    "set": {
                      "hl": 55
                    },
                    "stairs": [
                      {
                        "at": [
                          41.2,
                          5288
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  },
                  {
                    "near": [
                      22.6,
                      5318.4
                    ],
                    "set": {
                      "hl": 55,
                      "hw": 3,
                      "yaw": -12.1344
                    },
                    "stairs": [
                      {
                        "at": [
                          28.4,
                          5288
                        ],
                        "dir": -1,
                        "room": "mezz"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "lex",
                "lines": "4 5",
                "plats": [
                  {
                    "near": [
                      -115.7,
                      5356.7
                    ],
                    "stairs": [
                      {
                        "at": [
                          -112.2,
                          5298
                        ],
                        "dir": 1,
                        "room": "lex"
                      },
                      {
                        "at": [
                          -119.4,
                          5418
                        ],
                        "dir": -1,
                        "room": "lexs"
                      }
                    ]
                  },
                  {
                    "near": [
                      -102.7,
                      5359.4
                    ],
                    "stairs": [
                      {
                        "at": [
                          -99.07,
                          5298
                        ],
                        "dir": 1,
                        "room": "lex"
                      },
                      {
                        "at": [
                          -106.2,
                          5418
                        ],
                        "dir": -1,
                        "room": "lexs"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "irt23",
                "lines": "2 3",
                "plats": [
                  {
                    "near": [
                      161,
                      5338.5
                    ],
                    "y": -10,
                    "stairs": [
                      {
                        "at": [
                          166.1,
                          5300
                        ],
                        "dir": -1,
                        "room": "m23"
                      }
                    ]
                  }
                ]
              }
            ],
            "ents": [
              {
                "near": [
                  -102.2,
                  5444.1
                ],
                "room": "lexs"
              },
              {
                "set": {
                  "x": -90,
                  "z": 5276,
                  "yaw": 0
                },
                "room": "lex"
              },
              {
                "set": {
                  "x": 43,
                  "z": 5295,
                  "yaw": 90
                },
                "room": "mezz"
              }
            ],
            "links": [
              {
                "room": "mezz",
                "path": [
                  [
                    -86,
                    5286
                  ],
                  [
                    15,
                    5292
                  ]
                ]
              },
              {
                "room": "mezz",
                "path": [
                  [
                    70,
                    5294
                  ],
                  [
                    150,
                    5314
                  ]
                ]
              }
            ],
            "fare": [
              {
                "room": "mezz",
                "axis": "x",
                "at": 52.5,
                "gate": [
                  5300,
                  5302
                ]
              },
              {
                "room": "mezz",
                "axis": "z",
                "at": 5292.5,
                "span": [
                  19.85,
                  46.15
                ],
                "gate": [
                  34,
                  36
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": 20,
                "span": [
                  5288,
                  5292.65
                ]
              },
              {
                "room": "mezz",
                "axis": "x",
                "at": 46,
                "span": [
                  5288,
                  5292.65
                ]
              },
              {
                "room": "lex",
                "axis": "z",
                "at": 5290,
                "gate": [
                  -110,
                  -108
                ]
              },
              {
                "room": "lexs",
                "axis": "z",
                "at": 5425,
                "gate": [
                  -113,
                  -111
                ]
              },
              {
                "room": "m23",
                "axis": "z",
                "at": 5308,
                "gate": [
                  160,
                  162
                ]
              }
            ]
          }
        ]
      },
      "decks": {
        "mat": "asphalt_city",
        "barrierH": 1.1,
        "barrierT": 0.3,
        "barrierMinY": 2,
        "barrierMat": "concrete",
        "stepRise": 0.285,
        "colliderStep": 8,
        "pierceClear": 6,
        "link": {
          "maxGap": 45,
          "maxGrade": 0.15,
          "minCos": 0.94,
          "minY": 2,
          "join": 0.5
        }
      },
      "props": {
        "_note": "CPRP の pointKind → city_props.glb の部品（world.js CityProps.TYPES）。box = [半幅, 高さ, 半奥行き?]（当たりの箱 cat prop）、flip = 車道と反対を向く",
        "types": {
          "tree": {
            "type": "tree",
            "box": [
              0.16,
              3.2
            ],
            "mat": "crate"
          },
          "street_lamp": {
            "type": "streetlight",
            "box": [
              0.18,
              8.4
            ]
          },
          "traffic_signals": {
            "type": "traffic_signal",
            "box": [
              0.2,
              6
            ]
          },
          "fire_hydrant": {
            "type": "hydrant",
            "box": [
              0.25,
              0.77
            ],
            "mat": "barrel"
          },
          "bench": {
            "type": "bench",
            "box": [
              0.5,
              0.5
            ],
            "mat": "crate",
            "walk": true,
            "flip": true
          },
          "subway_entrance": {
            "type": "subway_entrance"
          },
          "waste_basket": {
            "type": "trash_can",
            "box": [
              0.32,
              0.89
            ]
          },
          "recycling": {
            "type": "trash_can",
            "box": [
              0.32,
              0.89
            ]
          },
          "post_box": {
            "type": "mailbox",
            "box": [
              0.27,
              1.2
            ]
          },
          "planter": {
            "type": "planter",
            "box": [
              0.6,
              0.7
            ],
            "mat": "concrete",
            "walk": true
          },
          "information": {
            "type": "phone_kiosk",
            "box": [
              0.35,
              2.6,
              0.2
            ]
          },
          "atm": {
            "type": "phone_kiosk",
            "box": [
              0.35,
              2.6,
              0.2
            ]
          },
          "vending_machine": {
            "type": "phone_kiosk",
            "box": [
              0.35,
              2.6,
              0.2
            ]
          },
          "street_cabinet": {
            "type": "hvac_unit",
            "box": [
              0.5,
              1.2,
              0.35
            ],
            "mat": "metalDark"
          },
          "block": {
            "type": "jersey_barrier",
            "box": [
              1.5,
              0.8,
              0.3
            ],
            "mat": "concrete",
            "walk": true
          }
        },
        "fences": {
          "_note": "see = 透ける柵（mat railing。world.js が棒の Canvas テクスチャで描く。当たりはそのまま）、h = データに高さが無い（ビルダーの既定 dataH のまま）ときの高さ m",
          "default": {
            "mat": "concrete"
          },
          "fence": {
            "mat": "railing",
            "nolos": true,
            "see": true,
            "h": 1.1,
            "dataH": 1.8
          },
          "chain": {
            "mat": "railing",
            "nolos": true,
            "see": true
          },
          "guard_rail": {
            "mat": "metalDark"
          },
          "bollard_line": {
            "mat": "metalDark",
            "nolos": true
          },
          "hedge": {
            "mat": "foliage"
          },
          "wall": {
            "mat": "concrete"
          },
          "retaining_wall": {
            "mat": "concrete"
          },
          "jersey_barrier": {
            "mat": "concrete"
          },
          "barrier": {
            "mat": "concrete"
          },
          "city_wall": {
            "mat": "limestone"
          }
        }
      },
      "city": {
        "jets": false,
        "boats": false,
        "ships": false
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
      "enterable": {
        "maxFloors": 6,
        "minArea": 150,
        "maxArea": 1500,
        "rectFill": 0.92,
        "chance": {
          "default": 0.35,
          "hot": 0.6
        },
        "tank": 0.3
      },
      "landmarkGlbs": [
        "landmarks",
        "landmarks2",
        "landmarks3",
        "landmarks4"
      ],
      "_landmarksNote": "M2: v1 の歩けるランドマーク（CityGen.lib.landmarks）を本物の場所へ。params は midtown.json の値（builder の座標 = midtown の座標）、offset [dx, dz] で世界へ平行移動（街の座標は両方ともマンハッタンの格子の向き。offset は整数 m: 1 m の歩行グラフの節点が midtown と同じ所に来る。端数（5.1 / 4.4）だとグランド・セントラルの棟の 1.45 m の階段の踊り場が節点の間に落ちて上の階へ行けなかった）。keep = 残す範囲（builder の座標、部品の中心で）、drop = 捨てる範囲（[x0, z0, x1, z1, y0?, y1?]）、dropDecals = 捨てる印の種類、add = 足す箱 [x0, y0, z0, x1, y1, z1, mat, cat, f]、entFix = genEnterable の扉の位置のずらし（sShift）・正面の扉の位置（mainDoor、隣の本物の建物・消した建物の残りに面した扉を開いた所へ）と面の外の扉を捨てる、footprint = ランドマークが使う矩形（消した建物の残り remnants はその外の部分だけ柱で出す。データの小物もその中は出さない）、helipads = 屋上・甲板のパッド（builder の座標）。plinthCut = 歩道・広場の台から抜く矩形（v1 の noPlinth と同じ: ロックフェラーのリンクの穴だけ。ほかのランドマークの床は v1 と同じく台 curbH の上）、cutDecks = 橋・高架の床を footprint の中で抜く（グランド・セントラル: パーク街高架橋は本物の建物の外形の中を 7 m で通る = v1 の両翼と重なる。南の取り付けと北の床は外形の手前で終わり、外形の壁に当たる）。suppress = 置き換える本物の建物の gid（tools/city-test-nyc.js の landmark suppress が重なりを確かめる）。carrier は世界の座標（offset 0）。姿勢は yaw 0 = 艦首が南（+z）・着艦は北から川の上を（tools/nyc/approach-check.js --yaw 0 で進入路に入るのは 88 番桟橋の名前の無い 15.6 m の 1 棟だけ。戦闘機は出さないので cap しない）、86 番桟橋の先端の 22 m 西（86 / 88 番桟橋の先端から船体まで 20 m 以上・84 番桟橋の先の細い腕まで 2.5 m）、params.stair は左舷（+X = 東 = 84 番桟橋の先の腕の上。midtown・landmarks2 の GLB の階段塔と同じ所）。Intrepid の本物の建物（86 番桟橋の南の 3 つ）は suppress で消す（前の姿勢の suppressUnder が消していた物）。空母の姿勢はデータ 1 か所 = params の x / z / yaw（yaw は 90° の倍数: _carrierStair と v1 の箱の向き）: 消す建物は suppressUnder（m。姿勢の下の甲板の外接矩形 + その幅に重心がある片の gid）、甲板の印のパッドは helipads[].local（姿勢の局所 [x, z]）、carrierOps（接地点・カタパルト・駐機）・approach-check・fixtures（make-fixtures.js）・復活の甲板のゾーン（respawn.js の deckZoneMargin）はどれも params から作る。空母のヘリ（spawn = 84 番桟橋（44 丁目）の上、階段塔の東 53 m・桟橋の並木（x −2523〜−2519）から回転翼の外まで 9 m 以上。世界の座標。tools/city-test-nyc.js が回転翼の円の中に木・箱が無いかも見る）だけは桟橋に置く物なので向きと別（tools/city-test-nyc.js が船体から離れているかを見る）。hudson_yards は移さない（本物の塔と人工地盤がデータにある）。グランド・セントラルは keep = footprint（v1 の組み立ては北の外にホームの列車・梯子・階段・戦利品を置くが、本物の場所ではそこが MetLife の下の空洞で歩いて行けない。tools/city-test-nyc.js がどのランドマークの物も footprint か keep の中（keep の中ならデータの建物の下でない）かを見る）。params.stair の舷は姿勢に付いてくる（足元が陸の側。塔の上の戦利品も一緒に写す。tools/city-test-nyc.js が yaw 0 と前の 86 番桟橋の横の yaw −90 / 90 で桟橋から歩けるかを見る）。ホットゾーン intrepid の中心も空母に合わせる（_hotZones）",
      "landmarks": [
        {
          "id": "gct",
          "kind": "gct",
          "anchor": "gct",
          "offset": [
            5,
            4
          ],
          "suppress": [
            29400,
            29399
          ],
          "cutDecks": true,
          "params": {
            "rect": [
              -65,
              -123,
              55,
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
              15,
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
            "platformRoof": 8.75
          },
          "footprint": [
            [
              -65,
              -123.4,
              55,
              -20
            ]
          ],
          "keep": [
            [
              -65,
              -123.4,
              55,
              -20
            ]
          ],
          "remnants": true,
          "add": [
            [
              -50,
              0.15,
              -123.4,
              40,
              4.2,
              -123,
              "limestone",
              "landmark",
              0
            ]
          ],
          "drop": [
            [
              -50,
              -123,
              40,
              -117,
              1.2,
              1.3
            ]
          ],
          "dropDecals": [
            "track"
          ],
          "entFix": {
            "gct_e": {
              "sShift": -42,
              "mainDoor": 20
            },
            "gct_w": {}
          },
          "helipads": [
            {
              "id": "gct",
              "label": "グランド・セントラル",
              "x": -5,
              "y": 38.15,
              "z": -88,
              "r": 9,
              "access": "climb"
            }
          ]
        },
        {
          "id": "library",
          "kind": "library",
          "anchor": "nypl",
          "offset": [
            -106,
            -2
          ],
          "suppress": [
            29451
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
          },
          "footprint": [
            [
              -330,
              42.75,
              -238.2,
              123.25
            ]
          ],
          "remnants": true
        },
        {
          "id": "rock",
          "kind": "rockefeller",
          "anchor": "rockefeller",
          "offset": [
            -47,
            -2
          ],
          "suppress": [],
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
          },
          "keep": [
            [
              -381.5,
              -626.5,
              -339.5,
              -573.5
            ],
            [
              -340,
              -608,
              -280,
              -592
            ]
          ],
          "footprint": [
            [
              -381.5,
              -626.5,
              -339.5,
              -573.5
            ],
            [
              -340,
              -608,
              -280,
              -592
            ]
          ],
          "plinthCut": [
            [
              -380,
              -625,
              -340,
              -575
            ]
          ]
        },
        {
          "id": "un",
          "kind": "un",
          "anchor": "un",
          "offset": [
            241,
            131
          ],
          "suppress": [
            36486,
            36510,
            36513
          ],
          "entFix": {
            "un_hall": {
              "mainDoor": 84
            }
          },
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
          },
          "keep": [
            [
              605,
              -471.3,
              709,
              -181.3
            ]
          ],
          "footprint": [
            [
              628,
              -258,
              650,
              -168
            ],
            [
              614,
              -428,
              660,
              -330
            ]
          ],
          "remnants": true
        },
        {
          "id": "boathouse",
          "kind": "boathouse",
          "anchor": "",
          "offset": [
            -114,
            -94
          ],
          "suppress": [
            38618
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
          },
          "footprint": [
            [
              -506,
              -2546,
              -474,
              -2522
            ],
            [
              -512,
              -2522,
              -488,
              -2484
            ]
          ],
          "remnants": true
        },
        {
          "id": "carrier",
          "kind": "carrier",
          "anchor": "intrepid",
          "offset": [
            0,
            0
          ],
          "suppress": [
            25376,
            25377,
            25378
          ],
          "suppressUnder": 2,
          "params": {
            "x": -2579,
            "z": -237,
            "yaw": 0,
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
          },
          "helipads": [
            {
              "id": "carrier",
              "label": "空母",
              "local": [
                2,
                -112
              ],
              "y": 15,
              "r": 6,
              "access": "walk",
              "spawn": [
                -2502,
                -164,
                90,
                0
              ]
            }
          ]
        }
      ],
      "_hotZones": "core のホットゾーン（@data）+ hotZonesAdd（同じ id は重ねる。b16: ビルド 14 のアプリが配列の hotZones / heliports を読めないので文字の @data のまま）。intrepid の中心は空母（landmarks の carrier の params x / z）に合わせる: 復活の甲板のゾーン（respawn.js deckZoneMargin）と city_dm から外す空母のゾーン（cityroom.js carrierZoneMargin）は中心が carrierOps.box から 30 m 以内のゾーン。空母の姿勢を変えたらここも",
      "hotZones": "@data",
      "hotZonesAdd": [
        {
          "id": "intrepid",
          "x": -2577,
          "z": -237
        }
      ],
      "_hotZoneChips": "復活する場所の選択肢に出す短い名前（nyc.json の label が 10 文字以上のもの。選択肢は「…」で切らない: tools/respawn-touch.js の nyc）",
      "hotZoneChips": {
        "gct": "グランドセントラル",
        "empire_state": "エンパイア",
        "rockefeller": "ロックフェラー",
        "bryant_park": "ブライアント公園",
        "washington_square": "ワシントン広場",
        "one_wtc": "ワンWTC",
        "brooklyn_bridge_park": "ブルックリン橋公園",
        "exchange_place": "エクスチェンジ",
        "south_street_seaport": "シーポート",
        "lic": "ロングアイランド"
      },
      "labels": "@data",
      "heliports": "@data",
      "heliportsAdd": [
        {
          "id": "fort_wood",
          "label": "フォート・ウッド（リバティ島）ヘリパッド",
          "x": -1642,
          "z": 8804,
          "y": 0,
          "r": 9,
          "access": "walk",
          "_note": "フォート・ウッド（女神の台座の星形の要塞）の西の広場（女神から 92 m）。半径 11 m の中に建物・木・段差なし。要塞のまわりの芝生は柵で囲まれた別の場所（島のスポーン地点の 4 分の 1 しか歩いて行けない）なので、島の西の桟橋・建物と同じ広い歩ける所に置く"
        },
        {
          "id": "governors_lawn",
          "label": "ガバナーズ島（パレード・グラウンド）ヘリパッド",
          "x": 479,
          "z": 7644,
          "y": 0,
          "r": 9,
          "access": "walk",
          "_note": "フォート・ジェイの南の芝生（パレード・グラウンド）。半径 24 m の中に建物・木・段差なし"
        }
      ],
      "heliportDefaults": {
        "y": 0,
        "r": 9,
        "access": "walk",
        "perHeliport": 1,
        "padCheck": 3.5,
        "padClear": 6,
        "roofNear": 500,
        "groundNear": 300,
        "_note": "本物のヘリポート（nyc.json）ごとに core HPAD の地上のパッド（その矩形の中・陸・中心から padCheck m の 8 点が陸・padClear m の中に建物なし）を perHeliport 個、中心に近い順。無ければヘリを出さない（ダウンタウンの 6 番桟橋はデータで水 = ヘリ無しのまま: 一番近い陸の HPAD は 1.3 km 先の屋上・2.4 km 先のジャージーシティで、6 番桟橋の代わりにならない。ダウンタウンのヘリはガバナーズ島のパッド）。地上の HPAD で本物のヘリポートの矩形の外のものはホットゾーンの縁から groundNear m 以内・平らなら歩いて行けるパッド（エクスチェンジ・プレイスの桟橋の先）。heliportsAdd の行はデータのパッドに足す（同じ id なら重ねる。b16: 古いアプリのため heliports は文字の @data のまま）。屋上の HPAD はホットゾーンの縁から roofNear m 以内だけ（入れる建物なら access climb、ほかは heli）"
      },
      "vehicles": {
        "heli": true,
        "jets": false,
        "boats": false,
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
        "parking": {
          "_note": "core RDS の車道の縁石の内側（curbInset m）に step m ごとの候補、ホットゾーンの縁から hotRange m 以内は nearHot、ほかは elsewhere の確率（v1 の 1 街区 1 台 × 確率 ≒ 縁石 620 m あたり）。classes の道だけ・幅 minWidth m 以上・片側 minSide m 以上・橋 / トンネル / 高架 / 広場 / 車なしは除く、ほかの車から spacing m、車の大きさ sizes [幅, 長さ]（game.json の vehicles.types と同じ値）+ 10 cm の 4 隅も確かめる、ほかの道の車道（中心線から縁石 + crossClear m）には置かない",
          "classes": [
            "primary",
            "secondary",
            "tertiary",
            "residential",
            "unclassified"
          ],
          "step": 40,
          "minWidth": 8,
          "minSide": 3.5,
          "curbInset": 1.7,
          "curbGap": 0.4,
          "crossClear": 3,
          "endClear": 3,
          "sizes": {
            "jeep": [
              2,
              4.35
            ],
            "pickup": [
              2,
              5.3
            ],
            "apc": [
              2.79,
              6.55
            ]
          },
          "length": 5.2,
          "halfWidth": 1.2,
          "spacing": 14,
          "hotRange": 500,
          "nearHot": 0.032,
          "elsewhere": 0.005
        }
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
        "parkPerCell": 0.04,
        "streetPerSpawn": 0.02,
        "hotPerSpawn": 0.08,
        "spawnOffset": 1
      },
      "rings": {
        "center": [
          -400,
          2500
        ],
        "randomCenter": 0.35,
        "startR": 7000,
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
      },
      "royale": {
        "_note": "game.json の royale の上に 1 段深く重ねる（game.js）。輸送ヘリは一番高い塔（One WTC 541 m・432 Park 426 m）より上、細長い島に沿う向き（landPick 本の向きから陸の多いもの）、計画 §5.7 の +30 % の速さ",
        "transport": {
          "height": 620,
          "speed": 110,
          "offset": 300,
          "landPick": 16,
          "landStep": 150
        }
      }
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
            47,
            49
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
            "hangarIn": {
              "section": 1,
              "floorY": 9,
              "hollow": 1,
              "wall": 1,
              "slab": 0.3,
              "floor0": 0,
              "liner": "plaster_interior",
              "ceiling": "plaster_interior",
              "floorMat": "concrete",
              "lights": [
                [
                  -7.3,
                  -95,
                  -6.7,
                  65,
                  15.6,
                  15.68
                ],
                [
                  -0.3,
                  -95,
                  0.3,
                  65,
                  15.6,
                  15.68
                ],
                [
                  6.7,
                  -95,
                  7.3,
                  65,
                  15.6,
                  15.68
                ]
              ],
              "openings": [
                [
                  0,
                  "x1",
                  34,
                  48,
                  9,
                  11.6
                ],
                [
                  0,
                  "x1",
                  -30,
                  -16,
                  9,
                  11.6
                ],
                [
                  0,
                  "x0",
                  -62,
                  -46,
                  9,
                  11.6
                ]
              ],
              "solids": [
                [
                  14.05,
                  37.8,
                  14.5,
                  38.2,
                  9,
                  11.6
                ],
                [
                  14.05,
                  41.8,
                  14.5,
                  42.2,
                  9,
                  11.6
                ],
                [
                  14.05,
                  45.8,
                  14.5,
                  46.2,
                  9,
                  11.6
                ],
                [
                  14.05,
                  -26.2,
                  14.5,
                  -25.8,
                  9,
                  11.6
                ],
                [
                  14.05,
                  -22.2,
                  14.5,
                  -21.8,
                  9,
                  11.6
                ],
                [
                  14.05,
                  -18.2,
                  14.5,
                  -17.8,
                  9,
                  11.6
                ],
                [
                  -14.5,
                  -58.2,
                  -14.05,
                  -57.8,
                  9,
                  11.6
                ],
                [
                  -14.5,
                  -54.2,
                  -14.05,
                  -53.8,
                  9,
                  11.6
                ],
                [
                  -14.5,
                  -50.2,
                  -14.05,
                  -49.8,
                  9,
                  11.6
                ]
              ],
              "props": [
                [
                  -7.2,
                  -68.5,
                  -4.8,
                  -51.5,
                  9,
                  12,
                  "metalDark"
                ],
                [
                  -11,
                  -62,
                  -1,
                  -58,
                  10.25,
                  10.65,
                  "metalDark"
                ],
                [
                  4.8,
                  -28.5,
                  7.2,
                  -11.5,
                  9,
                  12,
                  "metalDark"
                ],
                [
                  1,
                  -22,
                  11,
                  -18,
                  10.25,
                  10.65,
                  "metalDark"
                ],
                [
                  -1.15,
                  8.4,
                  1.15,
                  11.6,
                  9,
                  10.05,
                  "metalDark"
                ],
                [
                  -10,
                  20,
                  -7.7,
                  23.2,
                  9,
                  10.05,
                  "metalDark"
                ],
                [
                  8,
                  55,
                  9.2,
                  56.2,
                  9,
                  10.2,
                  "crate"
                ],
                [
                  9.3,
                  55,
                  10.5,
                  56.2,
                  9,
                  10.2,
                  "crate"
                ],
                [
                  8,
                  56.3,
                  9.2,
                  57.5,
                  9,
                  10.2,
                  "crate"
                ],
                [
                  8,
                  55,
                  9.2,
                  56.2,
                  10.2,
                  11.4,
                  "crate"
                ]
              ],
              "loot": [
                [
                  0,
                  9,
                  0
                ],
                [
                  -10,
                  9,
                  30
                ],
                [
                  10,
                  9,
                  -45
                ],
                [
                  -8,
                  9,
                  -85
                ]
              ],
              "walk": [
                [
                  15,
                  46,
                  18,
                  58,
                  7.7,
                  8
                ],
                [
                  15,
                  34,
                  17.5,
                  42,
                  8.75,
                  9.05
                ],
                [
                  17.9,
                  46,
                  18,
                  56,
                  8,
                  9.1,
                  2
                ],
                [
                  17.4,
                  34,
                  17.5,
                  46,
                  9.05,
                  10.15,
                  2
                ]
              ],
              "walkRamps": [
                [
                  15,
                  42,
                  17.4,
                  46,
                  8,
                  9.05,
                  -1
                ]
              ]
            },
            "islandIn": {
              "hollow": 4,
              "wall": 0.3,
              "slab": 0.3,
              "floor0": 0.05,
              "levels": [
                20.75
              ],
              "solidFrom": [
                [
                  5,
                  27.5
                ]
              ],
              "solids": [
                [
                  -18,
                  -14,
                  -14.5,
                  -12,
                  24.5,
                  27.5
                ]
              ],
              "door": [
                -15.6,
                -14,
                2.2
              ],
              "stair": {
                "x": [
                  -18,
                  -16.95,
                  -16.85,
                  -14.9
                ],
                "z": 13.5,
                "run": 3,
                "land": 1.5,
                "t": 0.3
              },
              "liner": "plaster_interior",
              "ceiling": "plaster_interior",
              "floorMat": "terrazzo",
              "stairMat": "metalDark",
              "windows": [
                [
                  3,
                  "x1",
                  7,
                  13.4,
                  31.2,
                  32.5
                ],
                [
                  3,
                  "x0",
                  8,
                  13.4,
                  31.2,
                  32.5
                ],
                [
                  2,
                  "x1",
                  0,
                  23.5,
                  28.4,
                  29.6
                ]
              ],
              "props": [
                [
                  -15,
                  0,
                  -14.3,
                  12,
                  30.4,
                  31.15,
                  "metalDark"
                ],
                [
                  -17.3,
                  2,
                  -16.1,
                  4,
                  30.4,
                  31.35,
                  "metalDark"
                ],
                [
                  -19.2,
                  -10,
                  -18.6,
                  -2,
                  17.05,
                  19,
                  "metalDark"
                ]
              ],
              "loot": [
                [
                  -16.5,
                  30.4,
                  9
                ],
                [
                  -14.5,
                  20.75,
                  0
                ]
              ],
              "lights": [
                [
                  -16.4,
                  -14,
                  -15.9,
                  13,
                  20.36,
                  20.43
                ],
                [
                  -16.4,
                  19,
                  -15.9,
                  30,
                  20.36,
                  20.43
                ],
                [
                  -16.4,
                  -10,
                  -15.9,
                  13,
                  24.11,
                  24.18
                ],
                [
                  -16.4,
                  19,
                  -15.9,
                  26,
                  24.11,
                  24.18
                ],
                [
                  -16.4,
                  -4,
                  -15.9,
                  12,
                  27.11,
                  27.18
                ],
                [
                  -16.6,
                  -1,
                  -16.1,
                  12,
                  30.01,
                  30.08
                ],
                [
                  -16.6,
                  0,
                  -16.1,
                  12,
                  33.01,
                  33.08
                ]
              ]
            },
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
          "id": "cruise",
          "kind": "ship",
          "claim": null,
          "params": {
            "type": "cruise_ship",
            "glb": "boats",
            "node": "cruise_ship",
            "x": -2224,
            "z": -601,
            "yaw": -90,
            "pier": "pier50",
            "boxes": [
              [
                5,
                16.2,
                124,
                7,
                18.2,
                126,
                0,
                "metalDark",
                "capstan"
              ],
              [
                -7,
                16.2,
                124,
                -5,
                18.2,
                126,
                0,
                "metalDark",
                "capstan"
              ],
              [
                -18.6,
                -8.6,
                -146,
                18.6,
                14.5,
                151,
                4,
                "hull_grey",
                "deck_hull"
              ],
              [
                -16.2,
                14.5,
                -128,
                16.2,
                18,
                104,
                4,
                "concrete",
                "tier0"
              ],
              [
                -18.9,
                18,
                -138,
                18.9,
                44,
                112,
                4,
                "concrete",
                "tierA"
              ],
              [
                -16.5,
                44,
                -122,
                16.5,
                49.5,
                92,
                4,
                "concrete",
                "tierB"
              ],
              [
                -12,
                49.5,
                -100,
                12,
                53.5,
                30,
                4,
                "concrete",
                "tierC"
              ],
              [
                -5.5,
                53.5,
                -96,
                5.5,
                67,
                -74,
                0,
                "metalDark",
                "funnel"
              ],
              [
                -21,
                38,
                102,
                21,
                41,
                106.5,
                4,
                "concrete",
                "bridge"
              ],
              [
                -3,
                49.5,
                57,
                3,
                55,
                63,
                0,
                "glass_tower",
                "dome"
              ],
              [
                14.49,
                49.5,
                -121.7,
                15.1,
                50.9,
                -121.45,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.1,
                49.5,
                -121.45,
                15.7,
                50.9,
                -121.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.7,
                49.5,
                -121.2,
                15.95,
                50.9,
                -120.6,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.95,
                49.5,
                -120.6,
                16.2,
                50.9,
                -120,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                16.15,
                49.5,
                -120,
                16.25,
                50.9,
                81,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.85,
                49.5,
                81,
                16.2,
                50.9,
                81.84,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.5,
                49.5,
                81.84,
                15.85,
                50.9,
                82.68,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                15.16,
                49.5,
                82.68,
                15.5,
                50.9,
                83.52,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                14.81,
                49.5,
                83.52,
                15.16,
                50.9,
                84.36,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                14.46,
                49.5,
                84.36,
                14.81,
                50.9,
                85.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                14.11,
                49.5,
                85.2,
                14.46,
                50.9,
                86.04,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                13.76,
                49.5,
                86.04,
                14.11,
                50.9,
                86.88,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                13.41,
                49.5,
                86.88,
                13.76,
                50.9,
                87.72,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                13.07,
                49.5,
                87.72,
                13.41,
                50.9,
                88.57,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                12.22,
                49.5,
                88.57,
                13.07,
                50.9,
                88.91,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.37,
                49.5,
                88.91,
                12.22,
                50.9,
                89.26,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                10.53,
                49.5,
                89.26,
                11.37,
                50.9,
                89.61,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                9.68,
                49.5,
                89.61,
                10.53,
                50.9,
                89.96,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                8.83,
                49.5,
                89.96,
                9.68,
                50.9,
                90.31,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                7.99,
                49.5,
                90.31,
                8.83,
                50.9,
                90.66,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                7.14,
                49.5,
                90.66,
                7.99,
                50.9,
                91.01,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                6.3,
                49.5,
                91.01,
                7.14,
                50.9,
                91.36,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                5.45,
                49.5,
                91.36,
                6.3,
                50.9,
                91.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -5.45,
                49.5,
                91.65,
                5.45,
                50.9,
                91.75,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -6.29,
                49.5,
                91.36,
                -5.45,
                50.9,
                91.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -7.14,
                49.5,
                91.01,
                -6.3,
                50.9,
                91.36,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -7.99,
                49.5,
                90.66,
                -7.14,
                50.9,
                91.01,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -8.83,
                49.5,
                90.31,
                -7.99,
                50.9,
                90.66,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -9.68,
                49.5,
                89.96,
                -8.83,
                50.9,
                90.31,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -10.53,
                49.5,
                89.61,
                -9.68,
                50.9,
                89.96,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.37,
                49.5,
                89.26,
                -10.53,
                50.9,
                89.61,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -12.22,
                49.5,
                88.91,
                -11.37,
                50.9,
                89.26,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -13.07,
                49.5,
                88.57,
                -12.22,
                50.9,
                88.91,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -13.41,
                49.5,
                87.72,
                -13.07,
                50.9,
                88.57,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -13.76,
                49.5,
                86.88,
                -13.41,
                50.9,
                87.72,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -14.11,
                49.5,
                86.04,
                -13.76,
                50.9,
                86.88,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -14.46,
                49.5,
                85.2,
                -14.11,
                50.9,
                86.04,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -14.81,
                49.5,
                84.36,
                -14.46,
                50.9,
                85.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.15,
                49.5,
                83.52,
                -14.81,
                50.9,
                84.36,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.5,
                49.5,
                82.68,
                -15.15,
                50.9,
                83.52,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.85,
                49.5,
                81.84,
                -15.5,
                50.9,
                82.68,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -16.2,
                49.5,
                81,
                -15.85,
                50.9,
                81.84,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -16.25,
                49.5,
                -120,
                -16.15,
                50.9,
                81,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -16.2,
                49.5,
                -120.6,
                -15.95,
                50.9,
                -120,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.95,
                49.5,
                -121.2,
                -15.7,
                50.9,
                -120.6,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.7,
                49.5,
                -121.45,
                -15.1,
                50.9,
                -121.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -15.1,
                49.5,
                -121.7,
                -14.49,
                50.9,
                -121.45,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -14.49,
                49.5,
                -121.75,
                14.49,
                50.9,
                -121.65,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                9.99,
                53.5,
                -99.7,
                10.6,
                54.9,
                -99.45,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                10.6,
                53.5,
                -99.45,
                11.2,
                54.9,
                -99.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.2,
                53.5,
                -99.2,
                11.45,
                54.9,
                -98.6,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.45,
                53.5,
                -98.6,
                11.7,
                54.9,
                -98,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.65,
                53.5,
                -98,
                11.75,
                54.9,
                24,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.37,
                53.5,
                24,
                11.7,
                54.9,
                24.8,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                11.03,
                53.5,
                24.8,
                11.37,
                54.9,
                25.61,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                10.7,
                53.5,
                25.61,
                11.03,
                54.9,
                26.42,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                10.36,
                53.5,
                26.42,
                10.7,
                54.9,
                27.22,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                10.03,
                53.5,
                27.22,
                10.36,
                54.9,
                28.03,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                9.22,
                53.5,
                28.03,
                10.03,
                54.9,
                28.37,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                8.41,
                53.5,
                28.37,
                9.22,
                54.9,
                28.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                7.59,
                53.5,
                28.7,
                8.41,
                54.9,
                29.03,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                6.78,
                53.5,
                29.03,
                7.59,
                54.9,
                29.37,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                5.97,
                53.5,
                29.37,
                6.78,
                54.9,
                29.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -5.97,
                53.5,
                29.65,
                5.97,
                54.9,
                29.75,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -6.78,
                53.5,
                29.37,
                -5.97,
                54.9,
                29.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -7.59,
                53.5,
                29.03,
                -6.78,
                54.9,
                29.37,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -8.41,
                53.5,
                28.7,
                -7.59,
                54.9,
                29.03,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -9.22,
                53.5,
                28.37,
                -8.41,
                54.9,
                28.7,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -10.03,
                53.5,
                28.03,
                -9.22,
                54.9,
                28.37,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -10.36,
                53.5,
                27.22,
                -10.03,
                54.9,
                28.03,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -10.7,
                53.5,
                26.42,
                -10.36,
                54.9,
                27.22,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.03,
                53.5,
                25.61,
                -10.7,
                54.9,
                26.42,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.37,
                53.5,
                24.8,
                -11.03,
                54.9,
                25.61,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.7,
                53.5,
                24,
                -11.37,
                54.9,
                24.8,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.75,
                53.5,
                -98,
                -11.65,
                54.9,
                24,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.7,
                53.5,
                -98.6,
                -11.45,
                54.9,
                -98,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.45,
                53.5,
                -99.2,
                -11.2,
                54.9,
                -98.6,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.2,
                53.5,
                -99.45,
                -10.6,
                54.9,
                -99.2,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -10.6,
                53.5,
                -99.7,
                -9.99,
                54.9,
                -99.45,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -9.99,
                53.5,
                -99.75,
                9.99,
                54.9,
                -99.65,
                2,
                "metalDark",
                "windbreak"
              ],
              [
                -11.4,
                14.5,
                109.4,
                11.4,
                14.95,
                110.7,
                4,
                "hull_grey",
                "step"
              ],
              [
                -11.4,
                14.5,
                110.7,
                11.4,
                15.25,
                112,
                4,
                "hull_grey",
                "step"
              ]
            ],
            "decks": [
              [
                -18.7,
                -137.8,
                18.7,
                -122.2,
                44
              ],
              [
                -16.1,
                -121.6,
                16.1,
                81,
                49.5
              ],
              [
                -12,
                81,
                12,
                88,
                49.5
              ],
              [
                -11.6,
                -99.6,
                11.6,
                24,
                53.5
              ],
              [
                -8,
                24,
                8,
                28,
                53.5
              ],
              [
                -14.5,
                -145,
                14.5,
                -128.2,
                14.5
              ]
            ],
            "ramps": [
              [
                -11.42,
                112,
                11.43,
                124,
                15.54,
                16.69,
                "z",
                1
              ],
              [
                -8.21,
                124,
                8.22,
                136,
                16.69,
                18.06,
                "z",
                1
              ],
              [
                -4.11,
                136,
                4.11,
                146,
                18.06,
                19.33,
                "z",
                1
              ]
            ],
            "edges": [
              [
                -18.6,
                -146.1,
                18.6,
                -146,
                14.5,
                15.5
              ],
              [
                -18.6,
                151,
                18.6,
                151.1,
                14.5,
                15.5
              ],
              [
                -18.7,
                -146,
                -18.6,
                -111,
                14.5,
                15.5
              ],
              [
                -18.7,
                -107.8,
                -18.6,
                151,
                14.5,
                15.5
              ],
              [
                18.6,
                -146,
                18.7,
                151,
                14.5,
                15.5
              ],
              [
                -18.9,
                -138.1,
                18.9,
                -138,
                44,
                45
              ],
              [
                -18.9,
                112,
                18.9,
                112.1,
                44,
                45
              ],
              [
                -19,
                -138,
                -18.9,
                -111,
                44,
                45
              ],
              [
                -19,
                -107.8,
                -18.9,
                112,
                44,
                45
              ],
              [
                18.9,
                -138,
                19,
                112,
                44,
                45
              ],
              [
                -16.5,
                -122.1,
                16.5,
                -122,
                49.5,
                50.5
              ],
              [
                -16.5,
                92,
                16.5,
                92.1,
                49.5,
                50.5
              ],
              [
                -16.6,
                -122,
                -16.5,
                92,
                49.5,
                50.5
              ],
              [
                16.5,
                -122,
                16.6,
                92,
                49.5,
                50.5
              ],
              [
                -12,
                -100.1,
                12,
                -100,
                53.5,
                54.5
              ],
              [
                -12,
                30,
                12,
                30.1,
                53.5,
                54.5
              ],
              [
                -12.1,
                -100,
                -12,
                30,
                53.5,
                54.5
              ],
              [
                12,
                -100,
                12.1,
                30,
                53.5,
                54.5
              ],
              [
                -21,
                101.9,
                -18.8,
                102,
                41,
                42
              ],
              [
                19,
                101.9,
                21,
                102,
                41,
                42
              ],
              [
                -21,
                106.5,
                -18.8,
                106.6,
                41,
                42
              ],
              [
                19,
                106.5,
                21,
                106.6,
                41,
                42
              ],
              [
                -21.1,
                102,
                -21,
                106.5,
                41,
                42
              ],
              [
                21,
                102,
                21.1,
                106.5,
                41,
                42
              ],
              [
                -11.5,
                110.7,
                -11.4,
                112,
                15.25,
                16.25
              ],
              [
                11.4,
                110.7,
                11.5,
                112,
                15.25,
                16.25
              ]
            ],
            "loot": [
              [
                6,
                49.5,
                -115
              ],
              [
                -6,
                49.5,
                -115
              ],
              [
                14,
                49.5,
                -40
              ],
              [
                -14,
                49.5,
                10
              ],
              [
                -6,
                49.5,
                50
              ],
              [
                6,
                49.5,
                75
              ],
              [
                0,
                14.5,
                -138
              ],
              [
                -17.4,
                14.5,
                40
              ]
            ],
            "tower": {
              "x0": -2116,
              "x1": -2100,
              "z0": -632,
              "z1": -628,
              "land": 3,
              "flightsLow": 4,
              "flightsHigh": 12,
              "y": [
                0,
                12.5,
                49.4
              ],
              "lowGang": {
                "z1": -619
              },
              "highGang": {
                "z1": -616.85,
                "rampTo": -610.01,
                "bottom": 47.5
              }
            },
            "lootTable": "ship",
            "interior": {
              "box": "tier0",
              "wall": 0.3,
              "slab": 0.3,
              "floor0": 0,
              "liner": "plaster_interior",
              "ceiling": "plaster_interior",
              "floorMat": "carpet_office",
              "openPlate": true,
              "openings": [
                [
                  0,
                  "x0",
                  -110.5,
                  -108.5,
                  14.5,
                  16.7
                ],
                [
                  0,
                  "x1",
                  -110.5,
                  -108.5,
                  14.5,
                  16.7
                ],
                [
                  0,
                  "x0",
                  59,
                  61,
                  14.5,
                  16.7
                ],
                [
                  0,
                  "x1",
                  59,
                  61,
                  14.5,
                  16.7
                ],
                [
                  0,
                  "z0",
                  -1,
                  1,
                  14.5,
                  16.7
                ]
              ],
              "lights": [
                [
                  -0.3,
                  -125,
                  0.3,
                  100,
                  17.61,
                  17.68
                ],
                [
                  -8.3,
                  -125,
                  -7.7,
                  100,
                  17.61,
                  17.68
                ],
                [
                  7.7,
                  -125,
                  8.3,
                  100,
                  17.61,
                  17.68
                ]
              ],
              "cabins": {
                "z0": -88,
                "z1": 100,
                "w": 4,
                "corridor": 1.2,
                "h": 3.2,
                "skip": [
                  [
                    56,
                    64
                  ]
                ],
                "bed": "crate"
              },
              "props": [
                [
                  -3,
                  -118,
                  3,
                  -116.8,
                  14.5,
                  15.6,
                  "wood_floor"
                ],
                [
                  -8.2,
                  -108.2,
                  -7.8,
                  -107.8,
                  14.5,
                  17.7,
                  "marble_floor"
                ],
                [
                  7.8,
                  -108.2,
                  8.2,
                  -107.8,
                  14.5,
                  17.7,
                  "marble_floor"
                ],
                [
                  -8.2,
                  -98.2,
                  -7.8,
                  -97.8,
                  14.5,
                  17.7,
                  "marble_floor"
                ],
                [
                  7.8,
                  -98.2,
                  8.2,
                  -97.8,
                  14.5,
                  17.7,
                  "marble_floor"
                ]
              ],
              "loot2": [
                [
                  0,
                  14.5,
                  -100
                ],
                [
                  -12,
                  14.5,
                  -120
                ],
                [
                  12,
                  14.5,
                  -95
                ],
                [
                  0,
                  14.5,
                  30
                ]
              ]
            }
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
      "overlay": {
        "_note": "Read only by citygen with CityGen.resolvePlan (Sky High). Old app builds ignore this field and keep the tower block above; tools/city-compat.js checks that.",
        "landmarks": [
          {
            "id": "skyhigh",
            "replaces": "tower",
            "kind": "skyhigh",
            "claim": [
              -45,
              -231,
              45,
              -186
            ],
            "params": {
              "x": 0,
              "z": -208,
              "podium": [
                40,
                18,
                30
              ],
              "portal": [
                8,
                14
              ],
              "lobby": [
                12,
                32.5,
                9,
                16.9
              ],
              "doors": [
                [
                  "entrance_w",
                  -16,
                  0.15,
                  16.9,
                  0,
                  4,
                  5
                ],
                [
                  "entrance_e",
                  16,
                  0.15,
                  16.9,
                  0,
                  4,
                  5
                ]
              ],
              "bastion": [
                32.5,
                10.5,
                0.8,
                36
              ],
              "prism": [
                26,
                18
              ],
              "pier": 4,
              "armoury": 122,
              "notch": [
                128,
                150
              ],
              "rail": 1.12,
              "sky": 256,
              "lantern": 1.06,
              "cap": [
                270,
                273.7,
                0.8
              ],
              "pad": [
                12,
                274
              ],
              "net": [
                1.6,
                273.3
              ],
              "armouryStair": [
                13,
                8,
                5
              ],
              "roofStair": [
                -5,
                13,
                5,
                6
              ],
              "crates": [
                [
                  -16,
                  9
                ],
                [
                  -16,
                  -9
                ],
                [
                  16,
                  -9
                ]
              ],
              "armouryLoot": [
                -10.5,
                -6.5,
                -10.5,
                6.5
              ],
              "perches": [
                [
                  -23.5,
                  128,
                  3
                ],
                [
                  23.5,
                  128,
                  -3
                ],
                [
                  0,
                  128,
                  -16
                ],
                [
                  8,
                  128,
                  16
                ],
                [
                  -23,
                  256,
                  4
                ],
                [
                  23,
                  256,
                  -4
                ],
                [
                  8,
                  256,
                  -15.5
                ],
                [
                  -10,
                  256,
                  15.5
                ]
              ],
              "mapIcon": "royale",
              "lift": {
                "id": "skyhigh",
                "core": [
                  -26,
                  -22,
                  -18,
                  -14
                ],
                "stations": [
                  [
                    "L0",
                    -21,
                    0.15,
                    -15.5,
                    90
                  ],
                  [
                    "L1",
                    -21,
                    128,
                    -15.5,
                    90
                  ],
                  [
                    "L2",
                    -21,
                    256,
                    -15.5,
                    90
                  ]
                ]
              }
            }
          }
        ],
        "heliports": [
          {
            "id": "h_tower",
            "label": "",
            "x": 0,
            "y": 274,
            "z": -208,
            "r": 10,
            "access": "lift"
          },
          {
            "id": "h_skyhigh_deck",
            "label": "",
            "x": 0,
            "y": 128,
            "z": -208,
            "r": 10,
            "access": "lift"
          },
          {
            "id": "h_rock",
            "label": "",
            "x": -412,
            "y": 260,
            "z": -600,
            "r": 9,
            "access": "heli"
          }
        ],
        "hotZones": [
          {
            "id": "skyhigh",
            "label": "スカイハイ",
            "x": 0,
            "z": -208,
            "r": 120,
            "loot": "hot"
          }
        ]
      },
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
        "jets": true,
        "boats": true,
        "boatTypes": {
          "speedboat": {
            "length": 7.94,
            "beam": 2.64
          },
          "patrol_boat": {
            "length": 12.2,
            "beam": 4.08
          },
          "water_taxi": {
            "length": 14.95,
            "beam": 4.36
          }
        }
      },
      "marinas": [
        {
          "id": "pier84",
          "label": "ピア84",
          "pier": "pier44",
          "face": "zmax",
          "at": 8,
          "len": 44,
          "wid": 3,
          "gap": 1.5,
          "top": 0.5,
          "gangLen": 8,
          "gangW": 2.4,
          "step": 13,
          "boats": [
            "speedboat",
            "patrol_boat",
            "speedboat"
          ]
        },
        {
          "id": "e34",
          "label": "イースト34丁目",
          "pier": "heli_east",
          "face": "zmin",
          "at": 6,
          "len": 40,
          "wid": 3,
          "gap": 1.5,
          "top": 0.5,
          "gangLen": 8,
          "gangW": 2.4,
          "step": 18,
          "boats": [
            "water_taxi",
            "speedboat"
          ]
        },
        {
          "id": "lic",
          "label": "ハンターズポイント",
          "pier": "lic_pier",
          "face": "zmax",
          "at": 5,
          "len": 34,
          "wid": 3,
          "gap": 1.5,
          "top": 0.5,
          "gangLen": 8,
          "gangW": 2.4,
          "step": 13,
          "boats": [
            "speedboat",
            "patrol_boat"
          ]
        }
      ],
      "shipping": {
        "margin": 120,
        "routes": [
          {
            "id": "hudson_ferry",
            "loop": "closed",
            "pts": [
              [
                -2440,
                2600
              ],
              [
                -2440,
                330
              ],
              [
                -2345,
                250
              ],
              [
                -2345,
                180
              ],
              [
                -2440,
                100
              ],
              [
                -2440,
                -2600
              ],
              [
                -2490,
                -2600
              ],
              [
                -2490,
                2600
              ]
            ],
            "stops": [
              {
                "x": -2345,
                "z": 215,
                "dwell": 25
              }
            ]
          },
          {
            "id": "east_ferry",
            "loop": "closed",
            "pts": [
              [
                830,
                700
              ],
              [
                830,
                585
              ],
              [
                912,
                480
              ],
              [
                912,
                -250
              ],
              [
                960,
                -328
              ],
              [
                1015,
                -328
              ],
              [
                1015,
                -362
              ],
              [
                940,
                -362
              ],
              [
                862,
                -280
              ],
              [
                862,
                560
              ]
            ],
            "stops": [
              {
                "x": 830,
                "z": 640,
                "dwell": 20
              },
              {
                "x": 990,
                "z": -328,
                "dwell": 20
              }
            ]
          },
          {
            "id": "circle_line",
            "loop": "closed",
            "pts": [
              [
                -2570,
                2400
              ],
              [
                -2570,
                -2400
              ],
              [
                -2630,
                -2400
              ],
              [
                -2630,
                2400
              ]
            ],
            "stops": [
              {
                "x": -2570,
                "z": 0,
                "dwell": 40
              }
            ]
          },
          {
            "id": "tug_east",
            "loop": "closed",
            "pts": [
              [
                985,
                700
              ],
              [
                985,
                2100
              ],
              [
                920,
                2100
              ],
              [
                920,
                700
              ]
            ]
          },
          {
            "id": "sail_hudson",
            "loop": "closed",
            "pts": [
              [
                -2700,
                2300
              ],
              [
                -2700,
                -2300
              ],
              [
                -2740,
                -2300
              ],
              [
                -2740,
                2300
              ]
            ]
          }
        ],
        "fleets": [
          {
            "type": "ferry_catamaran",
            "route": "hudson_ferry",
            "count": 2,
            "spacing": 0.5
          },
          {
            "type": "ferry_catamaran",
            "route": "east_ferry",
            "count": 1
          },
          {
            "type": "sightseeing_boat",
            "route": "circle_line",
            "count": 1
          },
          {
            "type": "tugboat_push",
            "route": "tug_east",
            "count": 1
          },
          {
            "type": "sailboat",
            "route": "sail_hudson",
            "count": 3,
            "spacing": 0.33
          }
        ]
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
          "skyhigh_gun": [
            [
              "rifle",
              3
            ],
            [
              "lmg",
              2
            ],
            [
              "sniper",
              2
            ]
          ],
          "skyhigh_vest": [
            [
              "armor_vest",
              1
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
          ],
          "ship": [
            [
              "rifle",
              3
            ],
            [
              "sniper",
              2
            ],
            [
              "p90",
              2
            ],
            [
              "ammo_556",
              4
            ],
            [
              "ammo_338",
              2
            ],
            [
              "ammo_57",
              2
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
    },
    "levels/nyc/nyc.json": {
      "id": "nyc",
      "format": 1,
      "source": {
        "name": "Overture Maps Foundation",
        "release": "2026-09-23.1",
        "bucket": "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com",
        "themes": [
          "base/infrastructure",
          "base/land",
          "base/land_use",
          "base/water",
          "buildings/building",
          "buildings/building_part",
          "places/place",
          "transportation/segment"
        ],
        "bboxLonLat": [
          -74.073522,
          40.654057,
          -73.918682,
          40.795756
        ],
        "fetched": "2026-10-10T12:23:41Z",
        "attribution": "© OpenStreetMap contributors, Overture Maps Foundation",
        "licenses": "ODbL 1.0 (OpenStreetMap-derived), CDLA-Permissive-2.0 (Overture), see README"
      },
      "frame": {
        "originLat": 40.7521252,
        "originLon": -73.9776773,
        "rotationDeg": 28.992,
        "projection": "+proj=tmerc +lat_0=40.75212520 +lon_0=-73.97767730 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs",
        "note": "x = grid east, -z = grid north, 1 unit = 1 m; origin = Park Ave axis x E 42nd St axis",
        "fit": {
          "rotationDeg": 28.992,
          "originLat": 40.7521252,
          "originLon": -73.9776773,
          "residualDeg": 0,
          "parkAveX": 0,
          "street42Z": 0
        },
        "checks": {
          "statue_of_liberty_torch_ll": [
            -1557.5,
            8843.1
          ],
          "empire_state_ll": [
            -391.65,
            684.86
          ]
        },
        "verify": {
          "references": [
            {
              "id": "empire_state",
              "lat": 40.748433,
              "lon": -73.985656,
              "x": -390.68,
              "z": 685.21,
              "dataX": -391.38,
              "dataZ": 684.45,
              "errorM": 1.03,
              "source": "Wikipedia"
            },
            {
              "id": "statue_of_liberty",
              "lat": 40.689247,
              "lon": -74.044502,
              "x": -1557.48,
              "z": 8843.47,
              "dataX": -1560.24,
              "dataZ": 8845.54,
              "errorM": 3.45,
              "source": "Wikipedia (statue)"
            },
            {
              "id": "gct",
              "lat": 40.752726,
              "lon": -73.977229,
              "x": 0.78,
              "z": -76.71,
              "dataX": 1.21,
              "dataZ": -67.32,
              "errorM": 9.4,
              "source": "Wikipedia (main building)"
            },
            {
              "id": "chrysler",
              "lat": 40.751652,
              "lon": -73.975311,
              "x": 200.26,
              "z": -50.9,
              "dataX": 198.36,
              "dataZ": -45.56,
              "errorM": 5.66,
              "source": "Wikipedia"
            },
            {
              "id": "one_wtc",
              "lat": 40.712742,
              "lon": -74.013382,
              "x": -519.49,
              "z": 5287.18,
              "dataX": -519.09,
              "dataZ": 5254.31,
              "errorM": 32.88,
              "source": "Wikipedia"
            },
            {
              "id": "flatiron",
              "lat": 40.741061,
              "lon": -73.989699,
              "x": -292.67,
              "z": 1566.79,
              "dataX": -286.11,
              "dataZ": 1570.6,
              "errorM": 7.58,
              "source": "Wikipedia"
            }
          ],
          "intersections": [
            {
              "id": "park_ave_x_42nd",
              "x": 0.3,
              "z": 0.79,
              "n": 1,
              "lat": 40.752118,
              "lon": -73.977679
            },
            {
              "id": "5th_ave_x_34th",
              "x": -309.76,
              "z": 637.75,
              "n": 1,
              "lat": 40.748454,
              "lon": -73.984545
            },
            {
              "id": "7th_ave_x_42nd",
              "x": -895.35,
              "z": -0.44,
              "n": 1,
              "lat": 40.756036,
              "lon": -73.986949
            },
            {
              "id": "broadway_x_5th_ave",
              "x": -311.09,
              "z": 1401.35,
              "n": 1,
              "lat": 40.742445,
              "lon": -73.988941
            },
            {
              "id": "state_st_x_whitehall",
              "x": 74.8,
              "z": 6265.62,
              "n": 1,
              "lat": 40.702441,
              "lon": -74.012837
            }
          ]
        }
      },
      "bounds": {
        "minX": -2900,
        "maxX": 3100,
        "minZ": -3000,
        "maxZ": 9800
      },
      "tile": 512,
      "tilesX": 12,
      "tilesZ": 25,
      "scale": 0.03125,
      "tileColumns": [
        "bytes",
        "buildings",
        "parts",
        "roads",
        "areas",
        "lines",
        "points",
        "prisms",
        "plinths",
        "decals",
        "props",
        "fences",
        "entb",
        "pieceAttrs",
        "rails",
        "portals",
        "stations"
      ],
      "tiles": {
        "0_0": [
          1312,
          0,
          0,
          0,
          6,
          36,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "0_1": [
          1368,
          0,
          0,
          5,
          2,
          0,
          0,
          0,
          0,
          0,
          20,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "0_3": [
          2012,
          1,
          0,
          0,
          21,
          0,
          0,
          3,
          0,
          0,
          2,
          0,
          0,
          2,
          0,
          0,
          0
        ],
        "0_4": [
          1600,
          3,
          0,
          3,
          6,
          0,
          0,
          6,
          0,
          0,
          0,
          0,
          0,
          3,
          0,
          0,
          0
        ],
        "0_5": [
          3524,
          5,
          0,
          10,
          21,
          0,
          0,
          12,
          0,
          0,
          35,
          0,
          1,
          9,
          0,
          0,
          0
        ],
        "0_6": [
          2056,
          1,
          0,
          6,
          16,
          1,
          0,
          1,
          0,
          0,
          0,
          9,
          0,
          1,
          0,
          0,
          0
        ],
        "0_7": [
          656,
          0,
          0,
          0,
          5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          4,
          0,
          0
        ],
        "0_8": [
          1824,
          1,
          0,
          3,
          9,
          2,
          0,
          2,
          0,
          0,
          0,
          14,
          0,
          2,
          2,
          0,
          0
        ],
        "0_11": [
          1560,
          0,
          0,
          7,
          6,
          0,
          0,
          0,
          3,
          0,
          22,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "0_12": [
          9436,
          9,
          0,
          46,
          35,
          0,
          0,
          11,
          29,
          9,
          316,
          30,
          0,
          10,
          0,
          0,
          0
        ],
        "0_13": [
          7824,
          7,
          0,
          42,
          36,
          0,
          0,
          25,
          21,
          2,
          24,
          3,
          0,
          14,
          31,
          0,
          1
        ],
        "0_14": [
          18760,
          26,
          0,
          66,
          40,
          2,
          0,
          51,
          56,
          119,
          123,
          42,
          0,
          35,
          5,
          0,
          0
        ],
        "0_15": [
          18048,
          19,
          0,
          102,
          17,
          2,
          0,
          48,
          79,
          196,
          143,
          41,
          0,
          32,
          8,
          0,
          0
        ],
        "0_16": [
          24052,
          41,
          0,
          154,
          31,
          1,
          0,
          84,
          139,
          242,
          43,
          6,
          0,
          53,
          15,
          0,
          0
        ],
        "0_17": [
          35952,
          209,
          0,
          132,
          50,
          2,
          0,
          299,
          129,
          177,
          30,
          0,
          0,
          233,
          16,
          0,
          0
        ],
        "0_18": [
          25008,
          56,
          0,
          80,
          47,
          76,
          0,
          101,
          90,
          70,
          177,
          82,
          0,
          70,
          2,
          0,
          0
        ],
        "0_19": [
          11024,
          1,
          0,
          74,
          15,
          77,
          0,
          1,
          33,
          44,
          53,
          10,
          0,
          1,
          1,
          0,
          0
        ],
        "0_20": [
          6272,
          1,
          0,
          27,
          7,
          0,
          0,
          2,
          18,
          64,
          21,
          8,
          0,
          1,
          0,
          0,
          0
        ],
        "0_21": [
          6992,
          1,
          0,
          30,
          13,
          2,
          0,
          1,
          31,
          61,
          1,
          15,
          0,
          1,
          0,
          0,
          0
        ],
        "0_22": [
          9268,
          4,
          0,
          34,
          20,
          0,
          0,
          5,
          36,
          33,
          53,
          6,
          0,
          4,
          0,
          0,
          0
        ],
        "0_23": [
          4904,
          2,
          0,
          25,
          13,
          4,
          0,
          2,
          22,
          0,
          68,
          0,
          0,
          2,
          0,
          0,
          0
        ],
        "1_0": [
          43996,
          224,
          0,
          186,
          40,
          20,
          0,
          268,
          70,
          270,
          133,
          226,
          1,
          230,
          5,
          0,
          1
        ],
        "1_1": [
          38116,
          151,
          0,
          163,
          27,
          2,
          0,
          222,
          50,
          66,
          115,
          123,
          0,
          203,
          2,
          0,
          0
        ],
        "1_2": [
          32168,
          41,
          0,
          191,
          42,
          2,
          0,
          141,
          75,
          139,
          229,
          169,
          0,
          109,
          2,
          0,
          0
        ],
        "1_3": [
          28336,
          38,
          0,
          192,
          58,
          7,
          0,
          123,
          90,
          325,
          251,
          41,
          5,
          93,
          2,
          0,
          0
        ],
        "1_4": [
          21840,
          86,
          0,
          123,
          37,
          4,
          0,
          132,
          80,
          168,
          83,
          20,
          19,
          131,
          0,
          0,
          0
        ],
        "1_5": [
          32072,
          86,
          0,
          123,
          49,
          5,
          0,
          180,
          102,
          299,
          141,
          44,
          24,
          164,
          0,
          0,
          0
        ],
        "1_6": [
          26940,
          28,
          0,
          150,
          86,
          5,
          0,
          71,
          132,
          204,
          225,
          196,
          20,
          66,
          7,
          2,
          0
        ],
        "1_7": [
          53032,
          50,
          0,
          257,
          165,
          3,
          0,
          113,
          177,
          193,
          581,
          610,
          9,
          110,
          80,
          7,
          1
        ],
        "1_8": [
          29932,
          47,
          0,
          105,
          74,
          16,
          0,
          176,
          74,
          337,
          132,
          24,
          13,
          155,
          4,
          0,
          0
        ],
        "1_9": [
          14492,
          15,
          0,
          70,
          34,
          11,
          0,
          133,
          31,
          87,
          66,
          17,
          5,
          92,
          0,
          0,
          0
        ],
        "1_10": [
          10412,
          3,
          0,
          98,
          38,
          1,
          0,
          16,
          0,
          0,
          90,
          50,
          0,
          14,
          0,
          0,
          0
        ],
        "1_13": [
          300,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          2,
          0,
          0
        ],
        "1_14": [
          1144,
          1,
          0,
          3,
          1,
          1,
          0,
          1,
          0,
          0,
          9,
          0,
          0,
          1,
          0,
          0,
          0
        ],
        "1_15": [
          1448,
          1,
          0,
          3,
          4,
          0,
          0,
          2,
          3,
          0,
          0,
          0,
          0,
          2,
          0,
          0,
          0
        ],
        "1_16": [
          8408,
          6,
          0,
          60,
          18,
          6,
          0,
          24,
          28,
          47,
          33,
          0,
          0,
          12,
          6,
          0,
          1
        ],
        "1_17": [
          27720,
          77,
          0,
          130,
          34,
          6,
          0,
          142,
          83,
          245,
          173,
          18,
          0,
          103,
          14,
          0,
          0
        ],
        "1_18": [
          13952,
          16,
          0,
          86,
          30,
          12,
          0,
          30,
          39,
          38,
          152,
          80,
          0,
          27,
          12,
          0,
          0
        ],
        "1_19": [
          10280,
          2,
          0,
          91,
          8,
          0,
          0,
          5,
          25,
          4,
          163,
          0,
          0,
          3,
          21,
          0,
          0
        ],
        "1_20": [
          3672,
          4,
          0,
          16,
          10,
          1,
          0,
          4,
          17,
          0,
          29,
          0,
          0,
          4,
          0,
          0,
          0
        ],
        "1_21": [
          4500,
          16,
          0,
          13,
          11,
          0,
          0,
          20,
          5,
          0,
          43,
          0,
          0,
          19,
          0,
          0,
          0
        ],
        "2_0": [
          53948,
          402,
          0,
          127,
          71,
          5,
          0,
          480,
          72,
          282,
          365,
          37,
          8,
          412,
          8,
          0,
          0
        ],
        "2_1": [
          54192,
          371,
          0,
          170,
          28,
          5,
          0,
          520,
          96,
          282,
          321,
          46,
          10,
          431,
          8,
          0,
          1
        ],
        "2_2": [
          39248,
          55,
          0,
          224,
          47,
          38,
          0,
          188,
          99,
          246,
          480,
          217,
          4,
          142,
          4,
          0,
          1
        ],
        "2_3": [
          41940,
          195,
          0,
          142,
          26,
          3,
          0,
          357,
          68,
          244,
          263,
          56,
          21,
          292,
          2,
          0,
          0
        ],
        "2_4": [
          55856,
          412,
          0,
          61,
          15,
          0,
          0,
          617,
          56,
          192,
          83,
          20,
          25,
          533,
          8,
          2,
          0
        ],
        "2_5": [
          59272,
          462,
          0,
          43,
          7,
          0,
          0,
          702,
          61,
          244,
          72,
          1,
          26,
          541,
          8,
          2,
          0
        ],
        "2_6": [
          57236,
          198,
          0,
          228,
          69,
          0,
          0,
          332,
          169,
          697,
          222,
          335,
          15,
          292,
          8,
          2,
          0
        ],
        "2_7": [
          64628,
          99,
          0,
          256,
          184,
          2,
          0,
          283,
          183,
          381,
          593,
          606,
          8,
          225,
          160,
          0,
          0
        ],
        "2_8": [
          49408,
          259,
          0,
          118,
          35,
          0,
          0,
          513,
          77,
          299,
          66,
          49,
          23,
          433,
          0,
          0,
          0
        ],
        "2_9": [
          50300,
          287,
          0,
          118,
          34,
          0,
          0,
          564,
          86,
          256,
          86,
          20,
          35,
          490,
          2,
          0,
          0
        ],
        "2_10": [
          47712,
          211,
          0,
          188,
          83,
          1,
          0,
          368,
          137,
          431,
          267,
          129,
          22,
          291,
          1,
          0,
          0
        ],
        "2_11": [
          24432,
          113,
          0,
          80,
          64,
          5,
          0,
          172,
          60,
          158,
          183,
          115,
          0,
          145,
          0,
          0,
          0
        ],
        "2_12": [
          7320,
          6,
          0,
          35,
          30,
          2,
          0,
          11,
          18,
          13,
          78,
          38,
          0,
          8,
          2,
          0,
          0
        ],
        "2_13": [
          2296,
          1,
          0,
          6,
          10,
          1,
          0,
          4,
          0,
          0,
          0,
          18,
          0,
          2,
          2,
          0,
          0
        ],
        "2_14": [
          216,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "2_16": [
          276,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          2,
          0,
          0
        ],
        "2_18": [
          2440,
          1,
          0,
          15,
          9,
          0,
          0,
          2,
          5,
          0,
          2,
          4,
          0,
          2,
          4,
          0,
          0
        ],
        "2_19": [
          3104,
          1,
          0,
          30,
          6,
          2,
          0,
          3,
          7,
          0,
          0,
          0,
          0,
          3,
          11,
          0,
          0
        ],
        "2_20": [
          7932,
          17,
          0,
          37,
          16,
          1,
          0,
          29,
          8,
          16,
          99,
          50,
          0,
          21,
          0,
          0,
          0
        ],
        "2_21": [
          5944,
          13,
          0,
          23,
          15,
          0,
          0,
          22,
          10,
          0,
          80,
          19,
          0,
          15,
          0,
          0,
          0
        ],
        "2_22": [
          6728,
          6,
          0,
          37,
          24,
          0,
          0,
          13,
          19,
          0,
          145,
          82,
          0,
          13,
          0,
          0,
          0
        ],
        "2_23": [
          16048,
          18,
          0,
          53,
          63,
          1,
          0,
          60,
          31,
          0,
          212,
          287,
          0,
          58,
          0,
          0,
          0
        ],
        "3_0": [
          47292,
          133,
          0,
          240,
          119,
          0,
          0,
          158,
          58,
          57,
          165,
          162,
          0,
          143,
          10,
          0,
          0
        ],
        "3_1": [
          36848,
          184,
          0,
          104,
          32,
          0,
          0,
          272,
          61,
          46,
          167,
          22,
          2,
          217,
          8,
          0,
          1
        ],
        "3_2": [
          35180,
          58,
          0,
          151,
          47,
          2,
          0,
          140,
          81,
          152,
          408,
          154,
          1,
          106,
          20,
          0,
          0
        ],
        "3_3": [
          59528,
          142,
          0,
          178,
          30,
          0,
          0,
          520,
          109,
          517,
          207,
          269,
          12,
          436,
          35,
          0,
          2
        ],
        "3_4": [
          54364,
          231,
          0,
          101,
          21,
          0,
          0,
          563,
          76,
          273,
          86,
          17,
          26,
          490,
          33,
          0,
          4
        ],
        "3_5": [
          52716,
          227,
          0,
          99,
          22,
          0,
          0,
          595,
          88,
          182,
          88,
          11,
          33,
          494,
          33,
          0,
          1
        ],
        "3_6": [
          33048,
          224,
          0,
          47,
          15,
          0,
          0,
          407,
          71,
          245,
          58,
          0,
          17,
          344,
          37,
          0,
          0
        ],
        "3_7": [
          51100,
          202,
          0,
          168,
          76,
          0,
          0,
          426,
          115,
          231,
          206,
          140,
          21,
          360,
          119,
          0,
          2
        ],
        "3_8": [
          39340,
          214,
          0,
          93,
          31,
          0,
          0,
          308,
          66,
          306,
          132,
          31,
          20,
          270,
          11,
          0,
          3
        ],
        "3_9": [
          67304,
          541,
          0,
          46,
          16,
          2,
          0,
          771,
          61,
          236,
          95,
          10,
          24,
          643,
          16,
          0,
          1
        ],
        "3_10": [
          71832,
          566,
          0,
          138,
          45,
          2,
          0,
          803,
          113,
          394,
          165,
          91,
          12,
          670,
          25,
          0,
          1
        ],
        "3_11": [
          74652,
          697,
          0,
          124,
          12,
          0,
          0,
          920,
          105,
          355,
          138,
          52,
          0,
          748,
          6,
          0,
          2
        ],
        "3_12": [
          43868,
          180,
          0,
          144,
          55,
          8,
          0,
          407,
          110,
          391,
          221,
          114,
          0,
          310,
          2,
          0,
          0
        ],
        "3_13": [
          27272,
          71,
          0,
          87,
          82,
          4,
          0,
          157,
          80,
          203,
          337,
          214,
          0,
          124,
          0,
          0,
          0
        ],
        "3_14": [
          24656,
          17,
          0,
          131,
          92,
          19,
          0,
          29,
          41,
          38,
          736,
          434,
          0,
          21,
          0,
          0,
          0
        ],
        "3_15": [
          35160,
          12,
          0,
          146,
          233,
          0,
          0,
          25,
          29,
          46,
          876,
          197,
          0,
          20,
          0,
          0,
          0
        ],
        "3_16": [
          6164,
          2,
          0,
          32,
          39,
          0,
          0,
          5,
          6,
          0,
          103,
          48,
          0,
          4,
          2,
          0,
          0
        ],
        "4_0": [
          35680,
          7,
          0,
          246,
          92,
          0,
          0,
          11,
          56,
          12,
          107,
          13,
          0,
          7,
          0,
          0,
          0
        ],
        "4_1": [
          19472,
          3,
          0,
          116,
          28,
          0,
          0,
          3,
          63,
          9,
          138,
          5,
          0,
          3,
          0,
          0,
          0
        ],
        "4_2": [
          35032,
          16,
          0,
          179,
          44,
          0,
          0,
          27,
          79,
          125,
          551,
          79,
          0,
          18,
          4,
          0,
          0
        ],
        "4_3": [
          61296,
          180,
          0,
          100,
          34,
          0,
          0,
          722,
          69,
          159,
          258,
          85,
          4,
          602,
          8,
          0,
          2
        ],
        "4_4": [
          43712,
          83,
          0,
          84,
          33,
          2,
          0,
          532,
          79,
          160,
          96,
          3,
          9,
          425,
          22,
          0,
          1
        ],
        "4_5": [
          56764,
          194,
          0,
          114,
          83,
          0,
          0,
          617,
          104,
          115,
          340,
          85,
          12,
          510,
          17,
          0,
          1
        ],
        "4_6": [
          58812,
          267,
          0,
          135,
          95,
          2,
          0,
          632,
          133,
          165,
          408,
          162,
          15,
          513,
          28,
          0,
          0
        ],
        "4_7": [
          49988,
          268,
          0,
          91,
          36,
          2,
          0,
          545,
          83,
          202,
          214,
          140,
          27,
          455,
          61,
          0,
          3
        ],
        "4_8": [
          44472,
          323,
          0,
          46,
          18,
          1,
          0,
          555,
          56,
          216,
          97,
          9,
          23,
          452,
          10,
          0,
          2
        ],
        "4_9": [
          36368,
          362,
          0,
          26,
          13,
          0,
          0,
          497,
          53,
          119,
          68,
          5,
          37,
          399,
          12,
          0,
          0
        ],
        "4_10": [
          53032,
          482,
          0,
          50,
          29,
          0,
          0,
          683,
          60,
          172,
          103,
          9,
          11,
          559,
          14,
          0,
          2
        ],
        "4_11": [
          80116,
          599,
          0,
          150,
          102,
          0,
          0,
          742,
          96,
          260,
          569,
          144,
          6,
          629,
          49,
          0,
          2
        ],
        "4_12": [
          71084,
          483,
          0,
          188,
          40,
          0,
          0,
          724,
          99,
          353,
          228,
          43,
          0,
          589,
          22,
          0,
          2
        ],
        "4_13": [
          60924,
          209,
          0,
          240,
          135,
          0,
          0,
          373,
          191,
          699,
          529,
          221,
          0,
          312,
          16,
          0,
          1
        ],
        "4_14": [
          67664,
          230,
          0,
          292,
          189,
          0,
          0,
          408,
          165,
          532,
          821,
          538,
          2,
          309,
          12,
          0,
          2
        ],
        "4_15": [
          78528,
          148,
          0,
          317,
          358,
          0,
          0,
          306,
          179,
          370,
          1523,
          624,
          3,
          237,
          19,
          0,
          1
        ],
        "4_16": [
          94776,
          51,
          0,
          346,
          413,
          14,
          0,
          236,
          427,
          333,
          1793,
          785,
          0,
          178,
          17,
          0,
          1
        ],
        "4_17": [
          72664,
          31,
          0,
          209,
          457,
          3,
          0,
          161,
          111,
          347,
          1530,
          826,
          0,
          135,
          0,
          0,
          0
        ],
        "4_18": [
          7136,
          3,
          0,
          39,
          23,
          0,
          0,
          12,
          12,
          0,
          28,
          90,
          0,
          11,
          0,
          0,
          0
        ],
        "5_0": [
          44352,
          360,
          0,
          87,
          9,
          0,
          0,
          465,
          87,
          378,
          92,
          6,
          17,
          392,
          8,
          0,
          1
        ],
        "5_1": [
          42952,
          345,
          0,
          83,
          11,
          0,
          0,
          468,
          88,
          294,
          120,
          7,
          16,
          369,
          8,
          0,
          1
        ],
        "5_2": [
          51288,
          411,
          0,
          83,
          17,
          0,
          0,
          601,
          79,
          363,
          126,
          5,
          19,
          514,
          18,
          0,
          0
        ],
        "5_3": [
          64672,
          154,
          0,
          157,
          25,
          1,
          0,
          799,
          132,
          408,
          270,
          79,
          12,
          659,
          56,
          0,
          0
        ],
        "5_4": [
          60612,
          111,
          0,
          113,
          35,
          1,
          0,
          699,
          105,
          367,
          127,
          11,
          13,
          601,
          253,
          0,
          1
        ],
        "5_5": [
          65948,
          90,
          0,
          243,
          56,
          0,
          0,
          720,
          155,
          278,
          272,
          85,
          8,
          584,
          146,
          0,
          1
        ],
        "5_6": [
          63056,
          277,
          0,
          198,
          26,
          1,
          0,
          746,
          125,
          299,
          216,
          17,
          8,
          632,
          14,
          0,
          0
        ],
        "5_7": [
          52396,
          273,
          0,
          98,
          26,
          0,
          0,
          657,
          90,
          335,
          209,
          11,
          16,
          576,
          8,
          0,
          1
        ],
        "5_8": [
          59860,
          157,
          0,
          210,
          90,
          0,
          0,
          395,
          124,
          347,
          511,
          642,
          14,
          320,
          8,
          0,
          3
        ],
        "5_9": [
          47604,
          281,
          0,
          142,
          63,
          0,
          0,
          443,
          108,
          264,
          258,
          165,
          14,
          355,
          16,
          0,
          0
        ],
        "5_10": [
          55992,
          239,
          0,
          153,
          46,
          0,
          0,
          521,
          107,
          366,
          287,
          330,
          6,
          399,
          18,
          0,
          1
        ],
        "5_11": [
          52352,
          180,
          0,
          157,
          105,
          8,
          0,
          333,
          88,
          269,
          739,
          129,
          1,
          252,
          8,
          0,
          1
        ],
        "5_12": [
          40992,
          288,
          0,
          133,
          25,
          4,
          0,
          444,
          90,
          240,
          155,
          17,
          3,
          351,
          12,
          0,
          2
        ],
        "5_13": [
          49560,
          442,
          0,
          121,
          20,
          0,
          0,
          635,
          92,
          292,
          193,
          20,
          0,
          529,
          27,
          0,
          1
        ],
        "5_14": [
          62808,
          289,
          0,
          201,
          94,
          0,
          0,
          485,
          140,
          337,
          556,
          376,
          9,
          387,
          50,
          0,
          1
        ],
        "5_15": [
          78888,
          191,
          0,
          360,
          163,
          0,
          0,
          437,
          143,
          458,
          918,
          826,
          9,
          368,
          36,
          0,
          3
        ],
        "5_16": [
          90784,
          180,
          0,
          483,
          170,
          1,
          0,
          623,
          192,
          312,
          859,
          722,
          1,
          491,
          19,
          0,
          2
        ],
        "5_17": [
          94648,
          133,
          0,
          415,
          140,
          0,
          0,
          702,
          134,
          461,
          975,
          565,
          2,
          578,
          37,
          0,
          5
        ],
        "5_18": [
          59456,
          47,
          0,
          243,
          184,
          2,
          0,
          91,
          129,
          101,
          1076,
          486,
          0,
          67,
          25,
          0,
          1
        ],
        "5_20": [
          14164,
          12,
          0,
          80,
          93,
          0,
          0,
          18,
          42,
          0,
          91,
          34,
          0,
          16,
          0,
          0,
          0
        ],
        "5_21": [
          35868,
          70,
          0,
          229,
          129,
          0,
          0,
          76,
          107,
          0,
          126,
          107,
          0,
          72,
          0,
          0,
          0
        ],
        "5_22": [
          13828,
          10,
          0,
          32,
          65,
          0,
          0,
          13,
          26,
          0,
          96,
          75,
          0,
          11,
          0,
          0,
          0
        ],
        "6_0": [
          47104,
          435,
          0,
          50,
          9,
          0,
          0,
          516,
          58,
          252,
          74,
          6,
          27,
          457,
          2,
          0,
          0
        ],
        "6_1": [
          44268,
          324,
          0,
          64,
          17,
          1,
          0,
          516,
          62,
          198,
          67,
          9,
          13,
          429,
          2,
          0,
          1
        ],
        "6_2": [
          50916,
          412,
          0,
          95,
          12,
          0,
          0,
          607,
          60,
          232,
          77,
          28,
          20,
          516,
          12,
          0,
          1
        ],
        "6_3": [
          52512,
          264,
          0,
          139,
          18,
          0,
          0,
          567,
          82,
          318,
          206,
          130,
          26,
          503,
          4,
          0,
          1
        ],
        "6_4": [
          61992,
          393,
          0,
          64,
          12,
          1,
          0,
          815,
          58,
          215,
          84,
          4,
          29,
          729,
          2,
          0,
          1
        ],
        "6_5": [
          66564,
          183,
          0,
          111,
          32,
          1,
          0,
          961,
          63,
          210,
          125,
          36,
          14,
          798,
          2,
          0,
          0
        ],
        "6_6": [
          61072,
          266,
          0,
          154,
          27,
          1,
          0,
          579,
          112,
          500,
          151,
          87,
          8,
          512,
          0,
          0,
          0
        ],
        "6_7": [
          60016,
          400,
          0,
          135,
          27,
          0,
          0,
          678,
          71,
          258,
          224,
          44,
          17,
          612,
          4,
          0,
          0
        ],
        "6_8": [
          56232,
          288,
          0,
          104,
          19,
          0,
          0,
          613,
          55,
          225,
          117,
          14,
          21,
          556,
          0,
          0,
          0
        ],
        "6_9": [
          54112,
          352,
          0,
          90,
          27,
          0,
          0,
          585,
          65,
          172,
          108,
          15,
          20,
          522,
          0,
          0,
          0
        ],
        "6_10": [
          61940,
          381,
          0,
          79,
          26,
          0,
          0,
          697,
          70,
          265,
          176,
          39,
          23,
          593,
          10,
          0,
          1
        ],
        "6_11": [
          68524,
          503,
          0,
          98,
          35,
          0,
          0,
          719,
          86,
          278,
          401,
          54,
          23,
          582,
          4,
          0,
          1
        ],
        "6_12": [
          58664,
          383,
          0,
          145,
          48,
          0,
          0,
          654,
          92,
          311,
          207,
          49,
          2,
          543,
          18,
          0,
          1
        ],
        "6_13": [
          72108,
          481,
          0,
          205,
          34,
          0,
          0,
          784,
          107,
          296,
          418,
          57,
          0,
          645,
          18,
          0,
          2
        ],
        "6_14": [
          94492,
          382,
          0,
          316,
          275,
          1,
          0,
          619,
          200,
          448,
          1247,
          539,
          0,
          477,
          33,
          1,
          0
        ],
        "6_15": [
          85160,
          95,
          0,
          380,
          279,
          0,
          0,
          197,
          265,
          435,
          1191,
          920,
          2,
          168,
          4,
          0,
          0
        ],
        "6_16": [
          81984,
          202,
          0,
          331,
          215,
          1,
          0,
          585,
          174,
          172,
          1111,
          321,
          0,
          483,
          6,
          0,
          0
        ],
        "6_17": [
          55132,
          64,
          0,
          356,
          143,
          5,
          0,
          298,
          115,
          180,
          821,
          388,
          0,
          253,
          4,
          0,
          0
        ],
        "6_18": [
          8616,
          5,
          0,
          52,
          22,
          0,
          0,
          30,
          32,
          39,
          48,
          40,
          0,
          26,
          10,
          0,
          0
        ],
        "6_19": [
          2144,
          1,
          0,
          6,
          12,
          1,
          0,
          2,
          0,
          0,
          0,
          30,
          0,
          2,
          0,
          0,
          0
        ],
        "6_20": [
          64076,
          95,
          0,
          362,
          361,
          0,
          0,
          128,
          177,
          0,
          591,
          387,
          0,
          101,
          0,
          0,
          0
        ],
        "6_21": [
          61792,
          29,
          0,
          192,
          346,
          0,
          0,
          39,
          192,
          0,
          638,
          622,
          0,
          29,
          0,
          0,
          0
        ],
        "6_22": [
          9316,
          6,
          0,
          21,
          70,
          2,
          0,
          11,
          16,
          0,
          55,
          53,
          0,
          8,
          0,
          0,
          0
        ],
        "7_0": [
          42668,
          300,
          0,
          64,
          12,
          0,
          0,
          380,
          74,
          200,
          43,
          3,
          17,
          314,
          0,
          0,
          0
        ],
        "7_1": [
          30676,
          157,
          0,
          76,
          18,
          0,
          0,
          262,
          63,
          182,
          93,
          8,
          9,
          190,
          0,
          0,
          0
        ],
        "7_2": [
          35968,
          173,
          0,
          117,
          13,
          0,
          0,
          283,
          63,
          227,
          37,
          16,
          11,
          239,
          11,
          0,
          0
        ],
        "7_3": [
          27872,
          147,
          0,
          101,
          20,
          0,
          0,
          207,
          55,
          210,
          75,
          48,
          7,
          169,
          2,
          0,
          0
        ],
        "7_4": [
          34768,
          148,
          0,
          98,
          36,
          1,
          0,
          220,
          86,
          324,
          309,
          231,
          5,
          170,
          2,
          0,
          0
        ],
        "7_5": [
          40396,
          46,
          0,
          169,
          138,
          0,
          0,
          127,
          143,
          145,
          529,
          327,
          1,
          102,
          2,
          0,
          0
        ],
        "7_6": [
          18676,
          20,
          0,
          99,
          26,
          0,
          0,
          81,
          75,
          174,
          138,
          109,
          2,
          68,
          3,
          0,
          0
        ],
        "7_7": [
          16616,
          35,
          0,
          85,
          16,
          0,
          0,
          85,
          56,
          158,
          43,
          15,
          2,
          58,
          4,
          0,
          0
        ],
        "7_8": [
          43048,
          56,
          0,
          232,
          91,
          0,
          0,
          179,
          93,
          292,
          210,
          178,
          5,
          145,
          0,
          0,
          0
        ],
        "7_9": [
          73564,
          109,
          0,
          391,
          358,
          0,
          0,
          225,
          81,
          306,
          67,
          5,
          4,
          179,
          0,
          0,
          0
        ],
        "7_10": [
          69608,
          462,
          0,
          154,
          139,
          0,
          0,
          694,
          74,
          249,
          135,
          159,
          14,
          554,
          2,
          0,
          1
        ],
        "7_11": [
          60812,
          465,
          0,
          96,
          47,
          0,
          0,
          596,
          64,
          196,
          325,
          456,
          33,
          522,
          0,
          0,
          0
        ],
        "7_12": [
          67600,
          455,
          0,
          142,
          47,
          0,
          0,
          753,
          103,
          365,
          124,
          19,
          8,
          621,
          6,
          0,
          0
        ],
        "7_13": [
          65820,
          391,
          0,
          228,
          55,
          0,
          0,
          668,
          108,
          267,
          248,
          22,
          0,
          550,
          21,
          0,
          1
        ],
        "7_14": [
          77080,
          378,
          0,
          294,
          145,
          0,
          0,
          543,
          165,
          362,
          586,
          322,
          0,
          428,
          12,
          1,
          1
        ],
        "7_15": [
          45004,
          26,
          0,
          187,
          201,
          0,
          0,
          64,
          168,
          116,
          664,
          512,
          0,
          45,
          2,
          0,
          0
        ],
        "7_16": [
          6572,
          5,
          0,
          55,
          22,
          1,
          0,
          12,
          23,
          10,
          54,
          9,
          0,
          10,
          2,
          0,
          0
        ],
        "7_17": [
          1896,
          0,
          0,
          4,
          10,
          0,
          0,
          1,
          7,
          0,
          0,
          0,
          0,
          1,
          4,
          0,
          0
        ],
        "7_18": [
          1208,
          0,
          0,
          0,
          5,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          4,
          0,
          0
        ],
        "7_19": [
          1280,
          0,
          0,
          2,
          4,
          0,
          0,
          1,
          0,
          0,
          0,
          11,
          0,
          1,
          0,
          0,
          0
        ],
        "7_20": [
          23728,
          27,
          0,
          146,
          170,
          3,
          0,
          32,
          45,
          0,
          198,
          52,
          0,
          28,
          0,
          0,
          0
        ],
        "7_21": [
          3596,
          1,
          0,
          9,
          21,
          0,
          0,
          12,
          13,
          0,
          9,
          11,
          0,
          6,
          0,
          0,
          0
        ],
        "7_22": [
          8048,
          22,
          0,
          49,
          8,
          0,
          0,
          37,
          53,
          32,
          21,
          12,
          0,
          32,
          0,
          0,
          0
        ],
        "7_23": [
          9108,
          25,
          0,
          58,
          17,
          0,
          0,
          35,
          42,
          16,
          137,
          2,
          0,
          31,
          0,
          0,
          0
        ],
        "8_0": [
          14812,
          18,
          0,
          74,
          31,
          2,
          0,
          31,
          44,
          122,
          44,
          40,
          0,
          21,
          0,
          0,
          0
        ],
        "8_1": [
          16964,
          18,
          0,
          72,
          20,
          0,
          0,
          45,
          28,
          60,
          40,
          2,
          0,
          20,
          0,
          0,
          0
        ],
        "8_2": [
          16084,
          19,
          0,
          91,
          30,
          0,
          0,
          34,
          42,
          130,
          95,
          0,
          0,
          22,
          4,
          0,
          1
        ],
        "8_3": [
          13488,
          13,
          0,
          58,
          56,
          0,
          0,
          29,
          25,
          95,
          265,
          27,
          0,
          16,
          2,
          0,
          0
        ],
        "8_4": [
          12040,
          5,
          0,
          52,
          39,
          0,
          0,
          10,
          23,
          44,
          356,
          62,
          0,
          7,
          2,
          0,
          0
        ],
        "8_5": [
          2596,
          2,
          0,
          5,
          16,
          0,
          0,
          3,
          8,
          0,
          30,
          0,
          0,
          2,
          2,
          0,
          0
        ],
        "8_6": [
          1076,
          0,
          0,
          1,
          2,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          4,
          0,
          0
        ],
        "8_7": [
          284,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
          0
        ],
        "8_8": [
          3008,
          0,
          0,
          5,
          15,
          0,
          0,
          5,
          11,
          0,
          0,
          2,
          0,
          3,
          0,
          0,
          0
        ],
        "8_9": [
          33836,
          29,
          0,
          184,
          146,
          0,
          0,
          63,
          78,
          285,
          70,
          124,
          1,
          44,
          0,
          0,
          0
        ],
        "8_10": [
          38308,
          195,
          0,
          139,
          61,
          0,
          0,
          315,
          61,
          74,
          89,
          1,
          18,
          265,
          2,
          0,
          0
        ],
        "8_11": [
          54720,
          385,
          0,
          75,
          47,
          0,
          0,
          573,
          62,
          97,
          84,
          36,
          29,
          466,
          0,
          0,
          0
        ],
        "8_12": [
          38700,
          217,
          0,
          124,
          48,
          1,
          0,
          347,
          91,
          256,
          82,
          45,
          0,
          282,
          2,
          0,
          0
        ],
        "8_13": [
          39132,
          117,
          0,
          196,
          54,
          0,
          0,
          295,
          88,
          298,
          185,
          17,
          0,
          229,
          8,
          1,
          0
        ],
        "8_14": [
          31272,
          81,
          0,
          181,
          62,
          0,
          0,
          173,
          103,
          155,
          150,
          83,
          0,
          129,
          6,
          0,
          0
        ],
        "8_15": [
          10844,
          2,
          0,
          52,
          45,
          0,
          0,
          3,
          16,
          8,
          123,
          58,
          0,
          3,
          8,
          0,
          0
        ],
        "8_16": [
          69120,
          119,
          0,
          356,
          253,
          0,
          0,
          187,
          184,
          359,
          1080,
          533,
          0,
          154,
          7,
          0,
          0
        ],
        "8_17": [
          52848,
          274,
          0,
          171,
          104,
          1,
          0,
          361,
          100,
          90,
          308,
          224,
          0,
          299,
          4,
          0,
          0
        ],
        "8_18": [
          33592,
          184,
          0,
          99,
          53,
          40,
          0,
          249,
          73,
          195,
          55,
          42,
          0,
          209,
          6,
          0,
          0
        ],
        "8_19": [
          14868,
          23,
          0,
          93,
          38,
          0,
          0,
          46,
          68,
          83,
          52,
          39,
          0,
          34,
          1,
          0,
          0
        ],
        "8_20": [
          13416,
          93,
          0,
          42,
          8,
          0,
          0,
          142,
          55,
          30,
          16,
          12,
          0,
          109,
          0,
          0,
          0
        ],
        "8_21": [
          20152,
          115,
          0,
          87,
          16,
          3,
          0,
          171,
          80,
          153,
          77,
          11,
          0,
          132,
          0,
          0,
          0
        ],
        "8_22": [
          37560,
          332,
          0,
          112,
          29,
          0,
          0,
          449,
          90,
          137,
          112,
          32,
          0,
          371,
          0,
          0,
          0
        ],
        "8_23": [
          33980,
          308,
          0,
          112,
          23,
          3,
          0,
          415,
          95,
          107,
          196,
          11,
          0,
          338,
          0,
          0,
          0
        ],
        "8_24": [
          4004,
          10,
          0,
          11,
          12,
          9,
          0,
          19,
          35,
          0,
          6,
          0,
          0,
          10,
          0,
          0,
          0
        ],
        "9_0": [
          21360,
          182,
          0,
          58,
          4,
          0,
          0,
          242,
          41,
          44,
          90,
          10,
          0,
          204,
          0,
          0,
          0
        ],
        "9_1": [
          18616,
          151,
          0,
          51,
          9,
          0,
          0,
          205,
          42,
          93,
          57,
          18,
          0,
          164,
          0,
          0,
          0
        ],
        "9_2": [
          16012,
          55,
          0,
          65,
          17,
          0,
          0,
          87,
          48,
          70,
          35,
          36,
          0,
          64,
          6,
          0,
          0
        ],
        "9_3": [
          20324,
          106,
          0,
          113,
          18,
          1,
          0,
          158,
          87,
          119,
          115,
          44,
          0,
          113,
          6,
          0,
          0
        ],
        "9_4": [
          22832,
          98,
          0,
          117,
          44,
          4,
          0,
          157,
          70,
          133,
          58,
          73,
          0,
          117,
          4,
          0,
          0
        ],
        "9_5": [
          41716,
          227,
          0,
          154,
          67,
          4,
          0,
          334,
          96,
          163,
          351,
          56,
          0,
          265,
          8,
          0,
          0
        ],
        "9_6": [
          27988,
          46,
          0,
          156,
          49,
          1,
          0,
          103,
          76,
          245,
          257,
          50,
          0,
          74,
          15,
          2,
          0
        ],
        "9_7": [
          14744,
          8,
          0,
          55,
          38,
          0,
          0,
          40,
          15,
          58,
          275,
          40,
          0,
          34,
          0,
          0,
          0
        ],
        "9_8": [
          1916,
          0,
          0,
          5,
          10,
          0,
          0,
          1,
          2,
          0,
          16,
          0,
          0,
          1,
          0,
          0,
          0
        ],
        "9_9": [
          1856,
          0,
          0,
          6,
          2,
          0,
          0,
          0,
          5,
          25,
          6,
          15,
          0,
          0,
          0,
          0,
          0
        ],
        "9_10": [
          8924,
          17,
          0,
          31,
          9,
          0,
          0,
          43,
          16,
          152,
          0,
          46,
          0,
          34,
          2,
          0,
          0
        ],
        "9_11": [
          13876,
          24,
          0,
          72,
          29,
          0,
          0,
          72,
          33,
          180,
          10,
          16,
          1,
          52,
          0,
          0,
          0
        ],
        "9_12": [
          21088,
          36,
          0,
          132,
          31,
          0,
          0,
          96,
          78,
          230,
          22,
          1,
          0,
          76,
          2,
          0,
          0
        ],
        "9_13": [
          31084,
          48,
          0,
          163,
          31,
          0,
          0,
          234,
          84,
          206,
          56,
          76,
          0,
          187,
          0,
          0,
          0
        ],
        "9_14": [
          10244,
          9,
          0,
          67,
          23,
          0,
          0,
          24,
          34,
          41,
          98,
          67,
          0,
          19,
          0,
          0,
          0
        ],
        "9_15": [
          28172,
          101,
          0,
          142,
          78,
          0,
          0,
          158,
          83,
          34,
          255,
          42,
          0,
          124,
          28,
          2,
          0
        ],
        "9_16": [
          64360,
          78,
          0,
          460,
          175,
          0,
          0,
          180,
          214,
          648,
          760,
          422,
          0,
          136,
          16,
          1,
          2
        ],
        "9_17": [
          59640,
          219,
          0,
          262,
          132,
          0,
          0,
          363,
          123,
          284,
          805,
          181,
          0,
          286,
          7,
          0,
          1
        ],
        "9_18": [
          63180,
          665,
          0,
          103,
          13,
          1,
          0,
          856,
          76,
          166,
          143,
          8,
          0,
          729,
          7,
          0,
          1
        ],
        "9_19": [
          60380,
          590,
          0,
          154,
          35,
          0,
          0,
          752,
          97,
          299,
          109,
          21,
          0,
          657,
          1,
          0,
          0
        ],
        "9_20": [
          66152,
          771,
          0,
          111,
          15,
          0,
          0,
          1000,
          90,
          177,
          84,
          27,
          0,
          854,
          0,
          0,
          0
        ],
        "9_21": [
          51120,
          424,
          0,
          193,
          42,
          1,
          0,
          538,
          112,
          441,
          94,
          121,
          0,
          460,
          0,
          0,
          0
        ],
        "9_22": [
          27488,
          125,
          0,
          134,
          29,
          0,
          0,
          192,
          72,
          170,
          69,
          6,
          0,
          130,
          0,
          0,
          0
        ],
        "9_23": [
          18336,
          47,
          0,
          141,
          27,
          0,
          0,
          89,
          81,
          109,
          100,
          0,
          0,
          66,
          0,
          0,
          0
        ],
        "9_24": [
          5300,
          5,
          0,
          28,
          9,
          0,
          0,
          9,
          29,
          12,
          33,
          0,
          0,
          5,
          0,
          0,
          0
        ],
        "10_0": [
          22360,
          173,
          0,
          108,
          12,
          0,
          0,
          230,
          64,
          53,
          75,
          6,
          0,
          181,
          0,
          0,
          0
        ],
        "10_1": [
          29916,
          247,
          0,
          102,
          15,
          0,
          0,
          335,
          85,
          195,
          52,
          15,
          0,
          271,
          0,
          0,
          0
        ],
        "10_2": [
          25416,
          154,
          0,
          105,
          9,
          0,
          0,
          243,
          68,
          142,
          62,
          1,
          0,
          180,
          4,
          0,
          1
        ],
        "10_3": [
          23284,
          92,
          0,
          163,
          11,
          1,
          0,
          168,
          83,
          196,
          53,
          10,
          0,
          108,
          22,
          1,
          0
        ],
        "10_4": [
          38772,
          268,
          0,
          139,
          44,
          0,
          0,
          368,
          89,
          209,
          80,
          78,
          0,
          290,
          12,
          0,
          1
        ],
        "10_5": [
          45924,
          250,
          0,
          245,
          42,
          3,
          0,
          335,
          129,
          518,
          134,
          84,
          0,
          275,
          33,
          4,
          3
        ],
        "10_6": [
          28596,
          122,
          0,
          161,
          26,
          0,
          0,
          200,
          86,
          168,
          167,
          130,
          0,
          147,
          41,
          2,
          0
        ],
        "10_7": [
          50676,
          493,
          0,
          103,
          24,
          0,
          0,
          661,
          79,
          122,
          151,
          49,
          0,
          543,
          2,
          0,
          0
        ],
        "10_8": [
          33264,
          258,
          0,
          96,
          40,
          0,
          0,
          344,
          73,
          70,
          330,
          41,
          0,
          282,
          0,
          0,
          0
        ],
        "10_9": [
          7324,
          10,
          0,
          37,
          20,
          1,
          0,
          24,
          28,
          25,
          0,
          29,
          0,
          15,
          0,
          0,
          0
        ],
        "10_10": [
          6312,
          2,
          0,
          34,
          29,
          3,
          0,
          8,
          13,
          0,
          179,
          12,
          0,
          7,
          2,
          0,
          0
        ],
        "10_11": [
          5832,
          4,
          0,
          32,
          31,
          1,
          0,
          8,
          10,
          6,
          89,
          2,
          0,
          7,
          0,
          0,
          0
        ],
        "10_12": [
          3584,
          3,
          0,
          27,
          21,
          0,
          0,
          3,
          2,
          0,
          35,
          0,
          0,
          3,
          2,
          0,
          0
        ],
        "10_13": [
          2524,
          2,
          0,
          9,
          11,
          0,
          0,
          6,
          7,
          0,
          10,
          2,
          0,
          5,
          0,
          0,
          0
        ],
        "10_14": [
          6528,
          15,
          0,
          26,
          16,
          17,
          0,
          29,
          12,
          6,
          0,
          19,
          0,
          21,
          0,
          0,
          0
        ],
        "10_15": [
          30912,
          141,
          0,
          119,
          15,
          7,
          0,
          268,
          104,
          103,
          55,
          85,
          0,
          220,
          0,
          0,
          0
        ],
        "10_16": [
          46424,
          86,
          0,
          220,
          119,
          0,
          0,
          142,
          181,
          542,
          653,
          312,
          0,
          109,
          12,
          0,
          0
        ],
        "10_17": [
          38932,
          82,
          0,
          209,
          106,
          6,
          0,
          178,
          128,
          315,
          455,
          200,
          0,
          125,
          32,
          0,
          1
        ],
        "10_18": [
          47272,
          252,
          0,
          150,
          48,
          6,
          0,
          412,
          109,
          382,
          318,
          142,
          8,
          343,
          36,
          0,
          0
        ],
        "10_19": [
          68512,
          728,
          0,
          90,
          25,
          2,
          0,
          982,
          61,
          155,
          116,
          0,
          5,
          815,
          8,
          0,
          1
        ],
        "10_20": [
          73352,
          838,
          0,
          108,
          28,
          0,
          0,
          1105,
          64,
          170,
          138,
          26,
          3,
          919,
          6,
          0,
          1
        ],
        "10_21": [
          63468,
          740,
          0,
          121,
          36,
          0,
          0,
          902,
          64,
          216,
          104,
          11,
          0,
          780,
          20,
          2,
          0
        ],
        "10_22": [
          35864,
          233,
          0,
          195,
          28,
          1,
          0,
          310,
          116,
          280,
          118,
          12,
          0,
          258,
          4,
          0,
          0
        ],
        "10_23": [
          12164,
          30,
          0,
          77,
          23,
          0,
          0,
          50,
          52,
          34,
          62,
          4,
          0,
          35,
          0,
          0,
          0
        ],
        "10_24": [
          2536,
          5,
          0,
          3,
          9,
          0,
          0,
          10,
          11,
          0,
          0,
          0,
          0,
          7,
          0,
          0,
          0
        ],
        "11_0": [
          25912,
          272,
          0,
          91,
          5,
          0,
          0,
          310,
          46,
          89,
          46,
          0,
          0,
          277,
          0,
          0,
          0
        ],
        "11_1": [
          30356,
          323,
          0,
          66,
          24,
          0,
          0,
          390,
          57,
          110,
          59,
          11,
          0,
          335,
          0,
          0,
          0
        ],
        "11_2": [
          31008,
          291,
          0,
          85,
          16,
          0,
          0,
          372,
          59,
          124,
          43,
          9,
          0,
          312,
          8,
          0,
          0
        ],
        "11_3": [
          28004,
          98,
          0,
          190,
          25,
          1,
          0,
          182,
          88,
          284,
          85,
          13,
          0,
          125,
          32,
          0,
          1
        ],
        "11_4": [
          24484,
          52,
          0,
          154,
          27,
          1,
          0,
          132,
          60,
          132,
          68,
          21,
          0,
          103,
          65,
          1,
          0
        ],
        "11_5": [
          13192,
          27,
          0,
          115,
          15,
          0,
          0,
          50,
          41,
          66,
          25,
          3,
          0,
          30,
          60,
          3,
          0
        ],
        "11_6": [
          14088,
          67,
          0,
          67,
          15,
          0,
          0,
          99,
          68,
          37,
          97,
          27,
          0,
          72,
          3,
          0,
          0
        ],
        "11_7": [
          40412,
          400,
          0,
          102,
          16,
          0,
          0,
          528,
          81,
          135,
          89,
          49,
          0,
          433,
          2,
          0,
          1
        ],
        "11_8": [
          51556,
          546,
          0,
          69,
          13,
          0,
          0,
          690,
          59,
          70,
          95,
          7,
          0,
          576,
          2,
          0,
          0
        ],
        "11_9": [
          19316,
          81,
          0,
          80,
          42,
          0,
          0,
          126,
          50,
          97,
          172,
          15,
          0,
          97,
          0,
          0,
          0
        ],
        "11_10": [
          26292,
          168,
          0,
          99,
          57,
          0,
          0,
          235,
          72,
          108,
          256,
          22,
          0,
          188,
          4,
          0,
          0
        ],
        "11_11": [
          29140,
          210,
          0,
          93,
          26,
          0,
          0,
          336,
          62,
          160,
          142,
          3,
          0,
          269,
          0,
          0,
          0
        ],
        "11_12": [
          30052,
          179,
          0,
          122,
          30,
          0,
          0,
          343,
          62,
          111,
          137,
          20,
          0,
          258,
          2,
          0,
          0
        ],
        "11_13": [
          13464,
          37,
          0,
          48,
          10,
          0,
          0,
          108,
          37,
          52,
          66,
          0,
          0,
          79,
          0,
          0,
          0
        ],
        "11_14": [
          7260,
          30,
          0,
          30,
          20,
          9,
          0,
          37,
          33,
          20,
          4,
          6,
          0,
          30,
          14,
          0,
          0
        ],
        "11_15": [
          13776,
          48,
          0,
          67,
          12,
          5,
          0,
          84,
          54,
          47,
          16,
          63,
          0,
          56,
          3,
          0,
          0
        ],
        "11_16": [
          22052,
          63,
          0,
          130,
          49,
          0,
          0,
          94,
          75,
          174,
          172,
          33,
          0,
          68,
          0,
          0,
          0
        ],
        "11_17": [
          23628,
          48,
          0,
          140,
          20,
          0,
          0,
          146,
          77,
          146,
          50,
          1,
          0,
          93,
          17,
          0,
          1
        ],
        "11_18": [
          42352,
          327,
          0,
          99,
          13,
          1,
          0,
          544,
          61,
          163,
          121,
          3,
          13,
          465,
          31,
          0,
          2
        ],
        "11_19": [
          42064,
          469,
          0,
          87,
          14,
          0,
          0,
          542,
          40,
          131,
          30,
          6,
          7,
          499,
          0,
          0,
          0
        ],
        "11_20": [
          42344,
          458,
          0,
          78,
          21,
          1,
          0,
          593,
          47,
          105,
          38,
          22,
          8,
          509,
          0,
          0,
          0
        ],
        "11_21": [
          22004,
          183,
          0,
          50,
          24,
          0,
          0,
          258,
          42,
          53,
          26,
          3,
          0,
          230,
          0,
          0,
          0
        ],
        "11_22": [
          14640,
          39,
          0,
          113,
          21,
          3,
          0,
          69,
          78,
          67,
          14,
          18,
          0,
          45,
          4,
          0,
          1
        ],
        "11_23": [
          9476,
          15,
          0,
          79,
          11,
          0,
          0,
          32,
          62,
          56,
          5,
          0,
          0,
          20,
          0,
          0,
          0
        ],
        "11_24": [
          4712,
          19,
          0,
          19,
          5,
          0,
          0,
          24,
          25,
          3,
          1,
          0,
          0,
          20,
          0,
          0,
          0
        ]
      },
      "totalBytes": 9015704,
      "tilesInAssets": true,
      "tileFile": "t_{tx}_{tz}.bin",
      "tileVersion": 2,
      "tilesNote": "tiles beside nyc.json (assets/levels/nyc/t_<tx>_<tz>.bin, common to both tiers, binary layout in tools/nyc/README.md and www/js/nycdata.js); tiles[key] = tileColumns; a key missing from tiles has no file (open water)",
      "core": {
        "file": "core.bin",
        "bytes": 2901508,
        "sha": "affcc09275132dbc",
        "version": 2,
        "pieces": 55804,
        "pieceIdx16": true,
        "entbMinMargin": 0.201
      },
      "chunk": 128,
      "enums": {
        "buildingClass": [
          "",
          "residential",
          "apartments",
          "house",
          "terrace",
          "commercial",
          "office",
          "retail",
          "hotel",
          "industrial",
          "warehouse",
          "garage",
          "parking",
          "shed",
          "roof",
          "church",
          "cathedral",
          "civic",
          "government",
          "school",
          "university",
          "hospital",
          "train_station",
          "transportation",
          "museum",
          "library",
          "stadium",
          "service",
          "religious",
          "education",
          "medical",
          "entertainment",
          "public",
          "boathouse",
          "other"
        ],
        "style": [
          "generic",
          "brownstone",
          "prewar_brick",
          "cast_iron",
          "artdeco_limestone",
          "modern_glass",
          "postwar",
          "industrial",
          "civic_stone",
          "house",
          "small",
          "terminal"
        ],
        "roofShape": [
          "",
          "flat",
          "gabled",
          "hipped",
          "skillion",
          "pyramidal",
          "saltbox",
          "dome",
          "round",
          "mansard",
          "onion",
          "gambrel",
          "half_hipped",
          "other"
        ],
        "material": [
          "",
          "brick",
          "glass",
          "plaster",
          "stone",
          "concrete",
          "metal",
          "wood",
          "cement_block",
          "roof_tiles",
          "grass",
          "slate",
          "tar_paper",
          "other"
        ],
        "roadClass": [
          "",
          "motorway",
          "trunk",
          "primary",
          "secondary",
          "tertiary",
          "residential",
          "unclassified",
          "living_street",
          "service",
          "alley",
          "driveway",
          "parking_aisle",
          "pedestrian",
          "footway",
          "sidewalk",
          "crosswalk",
          "steps",
          "cycleway",
          "path",
          "track",
          "bridleway",
          "unknown",
          "rail",
          "subway",
          "light_rail",
          "tram",
          "monorail",
          "funicular",
          "narrow_gauge"
        ],
        "areaKind": [
          "",
          "land",
          "water",
          "park",
          "grass",
          "garden",
          "plaza",
          "pedestrian",
          "pier",
          "beach",
          "railway",
          "parking",
          "pitch",
          "playground",
          "cemetery",
          "wood",
          "construction",
          "school",
          "industrial",
          "heliport",
          "wetland",
          "rock",
          "traffic_island",
          "bridge",
          "platform",
          "fountain",
          "helipad",
          "apron",
          "religious",
          "hospital",
          "marina",
          "golf",
          "dog_park",
          "scrub",
          "sand",
          "zoo",
          "flowerbed",
          "military",
          "bridge_support",
          "breakwater"
        ],
        "waterKind": [
          "",
          "river",
          "ocean",
          "lake",
          "pond",
          "reservoir",
          "basin",
          "canal",
          "stream",
          "fountain",
          "reflecting_pool",
          "pool",
          "dock",
          "other"
        ],
        "lineKind": [
          "",
          "fence",
          "wall",
          "retaining_wall",
          "hedge",
          "guard_rail",
          "jersey_barrier",
          "city_wall",
          "pier",
          "chain",
          "gate",
          "breakwater",
          "boardwalk",
          "tree_row",
          "barrier",
          "dam",
          "bollard_line"
        ],
        "pointKind": [
          "",
          "tree",
          "street_lamp",
          "traffic_signals",
          "fire_hydrant",
          "bench",
          "bus_stop",
          "subway_entrance",
          "bicycle_rental",
          "bicycle_parking",
          "waste_basket",
          "fountain",
          "artwork",
          "drinking_water",
          "post_box",
          "information",
          "crossing",
          "stop",
          "bollard",
          "viewpoint",
          "ferry_terminal",
          "toilets",
          "atm",
          "vending_machine",
          "power_pole",
          "flagpole",
          "lighting_tower",
          "give_way",
          "charging_station",
          "parking_entrance",
          "subway_station",
          "railway_station",
          "bell_tower",
          "communication_tower",
          "planter",
          "block",
          "recycling",
          "gate",
          "street_cabinet",
          "toll_booth"
        ]
      },
      "roadFlags": {
        "bridge": 1,
        "tunnel": 2,
        "link": 4,
        "oneway": 8,
        "plaza": 16,
        "elevated": 32,
        "twin": 64,
        "nocars": 128
      },
      "buildingFlags": {
        "hasParts": 1,
        "heightEstimated": 2,
        "landmark": 4,
        "ml": 8,
        "courtyard": 16,
        "elevated": 32,
        "minEstimated": 64,
        "multi": 128,
        "remainder": 256,
        "override": 512,
        "underConstruction": 1024,
        "floorsEstimated": 2048
      },
      "partFlags": {
        "estimated": 1,
        "remainder": 2
      },
      "railFlags": {
        "bridge": 1,
        "tunnel": 2,
        "ramp": 4,
        "disused": 8,
        "abandoned": 16,
        "elevated": 32,
        "covered": 64,
        "corridor": 128
      },
      "portalFlags": {
        "aboveGrade": 1
      },
      "stations": {
        "sources": [
          {
            "name": "MTA Subway Stations",
            "dataset": "data.ny.gov 39hk-dx4f",
            "fetched": "2026-10-24T14:11:28Z"
          },
          {
            "name": "MTA Subway Entrances and Exits: 2024",
            "dataset": "data.ny.gov i9wp-a4ja",
            "fetched": "2026-10-24T11:55:18Z"
          }
        ],
        "attribution": "Metropolitan Transportation Authority (MTA Open Data)",
        "license": "MTA Open Data (data.ny.gov) terms of use, attribution required",
        "counts": {
          "complexes": 99,
          "mta": 92,
          "path": 7,
          "platforms": 229,
          "snapped": 264,
          "snapMax": 14.64,
          "depth": {
            "shallow": 81,
            "deep": 16,
            "el": 2
          }
        },
        "entrances": {
          "mta": 769,
          "placed": 384,
          "in building": 209,
          "wrong complex": 1,
          "complex from gtfs": 5,
          "generated": 57,
          "generated complexes": 17
        },
        "rejected": {
          "building": 106,
          "not walkable": 12,
          "road": 45,
          "outside map": 4,
          "narrow": 4,
          "fence": 4,
          "spawn": 1
        }
      },
      "overrides": [
        {
          "osm": "w278033607",
          "name": "2 World Trade Center",
          "action": "cap",
          "height": 4,
          "status": "under construction",
          "gid": 301,
          "tile": "5_16",
          "x": -323.7,
          "z": 5251.8,
          "outline": 4
        },
        {
          "osm": "w372157751",
          "name": "Dey Street Headhouse",
          "action": "height",
          "height": 9,
          "status": "",
          "gid": 626,
          "tile": "5_16",
          "x": -133.7,
          "z": 5366.9,
          "outline": 9
        },
        {
          "osm": "w258744589",
          "name": "Saint Peter's Lutheran Church",
          "action": "height",
          "height": 17,
          "status": "",
          "gid": 28923,
          "tile": "6_4",
          "x": 192.3,
          "z": -937.5,
          "outline": 17
        },
        {
          "osm": "w265884394",
          "name": "The Lexington (511 Lexington Ave)",
          "action": "height",
          "height": 98,
          "status": "",
          "gid": 29058,
          "tile": "6_4",
          "x": 194.7,
          "z": -458.9,
          "outline": 98
        },
        {
          "osm": "w144919873",
          "name": "InterContinental New York Barclay",
          "action": "height",
          "height": 55,
          "status": "",
          "gid": 29076,
          "tile": "5_4",
          "x": 112.4,
          "z": -522.8,
          "outline": 55
        },
        {
          "osm": "w1197731542",
          "name": "343 Madison Avenue",
          "action": "cap",
          "height": 10,
          "status": "under construction",
          "gid": 29433,
          "tile": "5_5",
          "x": -123.6,
          "z": -204.7,
          "outline": 10
        },
        {
          "osm": "w1240348353",
          "name": "The Torch (740 Eighth Avenue)",
          "action": "cap",
          "height": 150,
          "status": "under construction",
          "gid": 30124,
          "tile": "3_5",
          "x": -1124.9,
          "z": -286.5,
          "outline": 150
        },
        {
          "osm": "w109280428",
          "name": "One Madison Avenue block (OSM name: Metropolitan Life Insurance Company Tower)",
          "action": "keep",
          "gid": 33460,
          "tile": "5_8",
          "x": -75,
          "z": 1471.2,
          "outline": 141.8
        },
        {
          "osm": "w1202082407",
          "name": "Casoni (989 Sixth Avenue)",
          "action": "keep",
          "gid": 31135,
          "tile": "4_6",
          "x": -649.6,
          "z": 424.2,
          "outline": 239.3
        },
        {
          "osm": "w1240350113",
          "name": "520 Fifth Avenue",
          "action": "keep",
          "gid": 29901,
          "tile": "4_5",
          "x": -344.5,
          "z": -108.3,
          "outline": 304.8
        },
        {
          "osm": "w1275711615",
          "name": "262 Fifth Avenue",
          "action": "keep",
          "gid": 31342,
          "tile": "5_7",
          "x": -338.3,
          "z": 1057,
          "outline": 262.1
        },
        {
          "osm": "w137564642",
          "name": "MetLife Building (200 Park Avenue)",
          "action": "keep",
          "gid": 29429,
          "tile": "5_5",
          "x": 1,
          "z": -176.8,
          "outline": 246
        },
        {
          "osm": "w158404390",
          "name": "Met Life Tower (1 Madison Avenue clock tower)",
          "action": "keep",
          "gid": 33440,
          "tile": "5_8",
          "x": -130.9,
          "z": 1451,
          "outline": 213.4
        }
      ],
      "anchors": {
        "gct": {
          "x": 1.21,
          "z": -67.32,
          "yaw": 0.1,
          "len": 121.1,
          "wid": 103.5,
          "rect": [
            -59.9,
            -119.3,
            61.2,
            -15.6
          ],
          "height": 45.8,
          "building": "76fa88dd-a26d-4716-9261-ffd8ba2a9a0c",
          "src": "building:Grand Central Terminal",
          "ja": "グランド・セントラル駅"
        },
        "one_times_square": {
          "x": -873.56,
          "z": -32.87,
          "yaw": -89.42,
          "len": 42.6,
          "wid": 19.1,
          "rect": [
            -881.1,
            -57.7,
            -862.1,
            -14.9
          ],
          "height": 110.6,
          "building": "7a836aff-35da-4666-acf1-5f511ba99d6f",
          "src": "building:One Times Square",
          "ja": "ワン・タイムズスクエア"
        },
        "tkts": {
          "x": -914.38,
          "z": -385.54,
          "yaw": 89.42,
          "len": 18,
          "wid": 14.8,
          "rect": [
            -922.9,
            -394,
            -907.9,
            -376.1
          ],
          "height": 5,
          "building": "dcf1bfd8-cc4f-4748-a639-4876445e9dc6",
          "src": "building:TKTS",
          "ja": "TKTS（ダフィー・スクエアの赤い階段）"
        },
        "duffy_square": {
          "x": -911.93,
          "z": -340.83,
          "rect": [
            -955,
            -415.7,
            -879,
            -245.4
          ],
          "area": 8264,
          "src": "area:Duffy Square",
          "ja": "ダフィー・スクエア"
        },
        "times_square": {
          "x": -886.54,
          "z": -155.37,
          "rect": [
            -933.4,
            -400.2,
            -832.3,
            -8.9
          ],
          "area": 13096,
          "src": "area:Times Square",
          "ja": "タイムズスクエア"
        },
        "empire_state": {
          "x": -391.38,
          "z": 684.45,
          "yaw": 0.02,
          "len": 129.7,
          "wid": 59.5,
          "rect": [
            -456.2,
            654.7,
            -326.5,
            714.2
          ],
          "height": 443.2,
          "building": "0e8abfe5-a7f3-4e8e-b6f0-db1fb0bb5b0c",
          "src": "building:Empire State Building",
          "ja": "エンパイア・ステート・ビル"
        },
        "chrysler": {
          "x": 198.36,
          "z": -45.56,
          "yaw": 0.01,
          "len": 63.9,
          "wid": 63.1,
          "rect": [
            169.2,
            -75.8,
            233.1,
            -12.7
          ],
          "height": 272,
          "building": "fe60f143-3e28-4128-838a-4288974ebb9b",
          "src": "building:Chrysler Building",
          "ja": "クライスラー・ビル"
        },
        "nypl": {
          "x": -395.41,
          "z": 80.74,
          "yaw": -89.89,
          "len": 113.8,
          "wid": 86.7,
          "rect": [
            -436.8,
            23.5,
            -350,
            137.3
          ],
          "height": 35,
          "building": "eea72a43-3d1c-4f0a-b81e-fb95d506a7e2",
          "src": "building:Stephen A. Schwarzman Building",
          "ja": "ニューヨーク公共図書館"
        },
        "bryant_park": {
          "x": -521.32,
          "z": 81.53,
          "rect": [
            -608.4,
            12.9,
            -436.2,
            150.5
          ],
          "area": 23312,
          "src": "area:Bryant Park",
          "ja": "ブライアント・パーク"
        },
        "rockefeller": {
          "x": -523.03,
          "z": -602.73,
          "yaw": 0.31,
          "len": 162.9,
          "wid": 57.5,
          "rect": [
            -606,
            -631.9,
            -443,
            -573.7
          ],
          "height": 260,
          "building": "8dceada5-5d68-4f87-b2e9-5eab34a1818a",
          "src": "building:30 Rockefeller Plaza",
          "ja": "ロックフェラー・センター"
        },
        "un": {
          "x": 879.78,
          "z": -81.51,
          "yaw": 89.78,
          "len": 90.2,
          "wid": 21.4,
          "rect": [
            869,
            -126.7,
            890.6,
            -36.5
          ],
          "height": 156.3,
          "building": "99616dbe-78e1-42c1-95c2-d6f25fca2080",
          "src": "building:United Nations Secretariat Building",
          "ja": "国連本部"
        },
        "flatiron": {
          "x": -286.11,
          "z": 1570.6,
          "yaw": -89.7,
          "len": 55.4,
          "wid": 28.9,
          "rect": [
            -296.7,
            1536.9,
            -267.8,
            1592.4
          ],
          "height": 88,
          "building": "427a3a3a-77ad-48b4-b3bc-8fb14852e601",
          "src": "building:Flatiron Building",
          "ja": "フラットアイアン・ビル"
        },
        "one_wtc": {
          "x": -519.09,
          "z": 5254.31,
          "yaw": -1.69,
          "len": 65.5,
          "wid": 65,
          "rect": [
            -552.6,
            5220.9,
            -485.6,
            5287.8
          ],
          "height": 541,
          "building": "619188bb-d1a3-4dae-9399-b971a791a5d4",
          "src": "building:One World Trade Center",
          "ja": "ワン・ワールドトレードセンター"
        },
        "oculus": {
          "x": -309.51,
          "z": 5322.94,
          "yaw": 9.12,
          "len": 110.4,
          "wid": 33,
          "rect": [
            -364.7,
            5305,
            -255.6,
            5341.2
          ],
          "height": 47,
          "building": "b63251e6-3c2b-44cb-8fb9-dd5de3984930",
          "src": "building:World Trade Center Transportation Hub - Oculus",
          "ja": "オキュラス"
        },
        "statue_of_liberty": {
          "x": -1560.24,
          "z": 8845.54,
          "yaw": 0.25,
          "len": 96.1,
          "wid": 94.2,
          "rect": [
            -1607.9,
            8798.2,
            -1511.8,
            8892.5
          ],
          "height": 46.9,
          "building": "901ab1bd-6c20-4da2-b411-e1141adcfa9c",
          "src": "building:Statue of Liberty",
          "ja": "自由の女神"
        },
        "ellis_island": {
          "x": -1718.56,
          "z": 7677.35,
          "yaw": 15.22,
          "len": 118.3,
          "wid": 66.7,
          "rect": [
            -1783.3,
            7636.7,
            -1656.3,
            7721.2
          ],
          "height": 10.2,
          "building": "49dc3729-2f3c-47c4-b302-d53ee20331dc",
          "src": "building:Ellis Island Immigration Museum",
          "ja": "エリス島"
        },
        "st_patricks": {
          "x": -246.67,
          "z": -682,
          "yaw": -0.53,
          "len": 94.1,
          "wid": 45.9,
          "rect": [
            -287.1,
            -705.1,
            -192.8,
            -659
          ],
          "height": 100.5,
          "building": "d78b2d58-7db4-4f23-9c85-6c5619536bb7",
          "src": "building:Saint Patrick’s Cathedral",
          "ja": "セント・パトリック大聖堂"
        },
        "woolworth": {
          "x": -128.63,
          "z": 5108.62,
          "yaw": 2.44,
          "len": 58.3,
          "wid": 44.2,
          "rect": [
            -160.9,
            5085.2,
            -100.8,
            5131.7
          ],
          "height": 237.8,
          "building": "a8c95904-bfb7-4e8e-875c-b3d9d2a93d84",
          "src": "building:Woolworth Building",
          "ja": "ウールワース・ビル"
        },
        "castle_clinton": {
          "x": -270.8,
          "z": 6327.84,
          "yaw": 34.75,
          "len": 62,
          "wid": 55,
          "rect": [
            -301.4,
            6296.3,
            -239.3,
            6358.2
          ],
          "height": 7.8,
          "building": "c0bd5fac-b7a9-4247-a459-9609419b0409",
          "src": "building:Castle Clinton",
          "ja": "キャッスル・クリントン"
        },
        "intrepid": {
          "x": -2394.57,
          "z": -279.23,
          "yaw": -3.47,
          "len": 276.5,
          "wid": 56.7,
          "rect": [
            -2527,
            -308.7,
            -2249.6,
            -248.3
          ],
          "height": 14,
          "building": "c7d8b011-6f09-414e-be35-c71a108ed366",
          "src": "building:USS Intrepid",
          "ja": "イントレピッド博物館（86 番桟橋）"
        },
        "hudson_yards": {
          "x": -1790.59,
          "z": 760.72,
          "yaw": -0.21,
          "len": 117.2,
          "wid": 58.1,
          "rect": [
            -1847.5,
            731.5,
            -1730.3,
            789.9
          ],
          "height": 395,
          "building": "4832c177-eea1-4558-97d3-2ffe55202752",
          "src": "building:30 Hudson Yards",
          "ja": "ハドソン・ヤード"
        },
        "heliport_w30": {
          "x": -2327.29,
          "z": 927.61,
          "rect": [
            -2410.3,
            826.2,
            -2301.2,
            1051.7
          ],
          "area": 6431,
          "src": "area:West 30th Street Heliport",
          "ja": "ウエスト 30 丁目ヘリポート"
        },
        "heliport_e34": {
          "x": 939.48,
          "z": 717.87,
          "rect": [
            915.1,
            676.2,
            964.8,
            766.9
          ],
          "area": 2261,
          "src": "area:East 34th Street Heliport",
          "ja": "イースト 34 丁目ヘリポート"
        },
        "heliport_downtown": {
          "x": 448.4,
          "z": 6211.12,
          "rect": [
            347.9,
            6145,
            521.5,
            6276.9
          ],
          "area": 6797,
          "src": "area:Downtown Manhattan Heliport",
          "ja": "ダウンタウン・マンハッタン・ヘリポート（6 番桟橋）"
        },
        "battery_park": {
          "x": -169.06,
          "z": 6321.63,
          "rect": [
            -368.5,
            6125.9,
            43.2,
            6514.5
          ],
          "area": 88307,
          "src": "area:Battery Park",
          "ja": "バッテリー・パーク"
        },
        "central_park": {
          "x": -736.35,
          "z": -2181.7,
          "rect": [
            -1156.2,
            -3000.3,
            -321.7,
            -1386.4
          ],
          "area": 1241974,
          "src": "area:Central Park",
          "ja": "セントラル・パーク"
        },
        "union_square": {
          "x": -64.65,
          "z": 2102.85,
          "rect": [
            -125.1,
            1981.2,
            34.5,
            2211.8
          ],
          "area": 26060,
          "src": "area:Union Square Park",
          "ja": "ユニオン・スクエア"
        },
        "washington_square": {
          "x": -328.79,
          "z": 2877.87,
          "rect": [
            -481.7,
            2796.3,
            -175.8,
            2959.9
          ],
          "area": 42540,
          "src": "area:Washington Square Park",
          "ja": "ワシントン・スクエア"
        },
        "madison_square": {
          "x": -227.42,
          "z": 1385.1,
          "rect": [
            -302.3,
            1277.4,
            -162.9,
            1504
          ],
          "area": 28767,
          "src": "area:Madison Square Park",
          "ja": "マディソン・スクエア・パーク"
        },
        "herald_square": {
          "x": -648.87,
          "z": 591,
          "rect": [
            -686,
            558.7,
            -626.9,
            631.3
          ],
          "area": 3017,
          "src": "area:Herald Square",
          "ja": "ヘラルド・スクエア"
        },
        "governors_island": {
          "x": 346.29,
          "z": 7843.66,
          "rect": [
            -49.2,
            7256,
            821.7,
            8552.1
          ],
          "area": 695430,
          "src": "area:Governors Island",
          "ja": "ガバナーズ島"
        },
        "wall_street": {
          "x": -50.99,
          "z": 5753.63,
          "yaw": 87.29,
          "len": 70.6,
          "wid": 44.7,
          "rect": [
            -74.1,
            5718.3,
            -26.8,
            5786.8
          ],
          "height": 104.8,
          "building": "d7391ece-963b-4231-935a-7ef458556982",
          "src": "building:New York Stock Exchange",
          "ja": "ウォール街（NY 証券取引所）"
        },
        "dumbo": {
          "x": 1798.34,
          "z": 5202.18,
          "src": "latlon",
          "ja": "ダンボ"
        },
        "brooklyn_bridge_park": {
          "x": 1398.53,
          "z": 5981.48,
          "rect": [
            1174.9,
            4937,
            1917.5,
            6812.8
          ],
          "area": 242110,
          "src": "area:Brooklyn Bridge Park",
          "ja": "ブルックリン・ブリッジ・パーク"
        },
        "exchange_place": {
          "x": -2168.57,
          "z": 5748.28,
          "src": "latlon",
          "ja": "エクスチェンジ・プレイス"
        },
        "high_line": {
          "x": -1809.2,
          "z": 1514.79,
          "rect": [
            -2251.3,
            658.9,
            -1569.3,
            2486.4
          ],
          "area": 28962,
          "src": "area:The High Line",
          "ja": "ハイライン"
        },
        "madison_square_garden": {
          "x": -1082.32,
          "z": 802.26,
          "yaw": 1.24,
          "len": 144.6,
          "wid": 128.6,
          "rect": [
            -1154.6,
            738,
            -1009.9,
            866.6
          ],
          "height": 45,
          "building": "5beba8e9-7dc4-4284-8ed7-98377c3a59bc",
          "src": "building:Madison Square Garden",
          "ja": "マディソン・スクエア・ガーデン"
        },
        "penn_station": {
          "x": -1086.77,
          "z": 795.71,
          "src": "latlon",
          "ja": "ペン駅"
        },
        "roosevelt_island": {
          "x": 1458.77,
          "z": -2049.73,
          "src": "latlon",
          "ja": "ルーズベルト島"
        },
        "lic": {
          "x": 2554.94,
          "z": -473.53,
          "src": "latlon",
          "ja": "ロングアイランドシティ"
        },
        "chinatown": {
          "x": 526.99,
          "z": 4319.56,
          "src": "latlon",
          "ja": "チャイナタウン"
        },
        "soho": {
          "x": -98.25,
          "z": 3713.77,
          "src": "latlon",
          "ja": "ソーホー"
        },
        "south_street_seaport": {
          "x": 741.45,
          "z": 5505.12,
          "yaw": 21.04,
          "len": 104.2,
          "wid": 62.1,
          "rect": [
            682.1,
            5457.7,
            801.6,
            5552.8
          ],
          "height": 10.2,
          "building": "0648dbe0-4355-49df-88a6-377dc6b51236",
          "src": "building:Pier 17",
          "ja": "サウス・ストリート・シーポート（17 番桟橋）"
        },
        "vessel": {
          "x": -1898.83,
          "z": 838.66,
          "yaw": -61.18,
          "len": 46.7,
          "wid": 45.8,
          "rect": [
            -1921.9,
            815.3,
            -1875.4,
            862.3
          ],
          "height": 45.7,
          "building": "4865ce8b-6a18-4b6e-b5b8-79170d9d2075",
          "src": "building:Vessel",
          "ja": "ベッセル（ハドソン・ヤード）"
        },
        "pier_86": {
          "x": -2390.03,
          "z": -318.24,
          "rect": [
            -2542.4,
            -342.8,
            -2236.5,
            -294.7
          ],
          "area": 14125,
          "src": "area:Pier 86",
          "ja": "86 番桟橋"
        }
      },
      "bridges": [
        {
          "id": "brooklyn_bridge",
          "name": "Brooklyn Bridge Promenade",
          "ja": "ブルックリン橋",
          "axis": [
            0.95487,
            0.29702
          ],
          "ends": [
            [
              207.1,
              4989.8
            ],
            [
              1903.9,
              5517.6
            ]
          ],
          "towers": [
            [
              887.35,
              5202.96
            ],
            [
              1351.89,
              5347.45
            ]
          ],
          "mainSpanTowers": [
            0,
            1
          ],
          "towerSource": "bridge_support",
          "towerTop": 82.9,
          "deckTower": 36,
          "deckMid": 41,
          "mainSpan": 486.5,
          "pieces": 44
        },
        {
          "id": "manhattan_bridge",
          "name": "Manhattan Bridge Bike Path",
          "ja": "マンハッタン橋",
          "axis": [
            0.78226,
            0.62295
          ],
          "ends": [
            [
              722.3,
              4298.8
            ],
            [
              2168.4,
              5450.4
            ]
          ],
          "towers": [
            [
              1310.42,
              4772.74
            ],
            [
              1661.05,
              5047.77
            ]
          ],
          "mainSpanTowers": [
            0,
            1
          ],
          "towerSource": "bridge_support",
          "towerTop": 102,
          "deckTower": 38,
          "deckMid": 41,
          "mainSpan": 445.6,
          "pieces": 10
        },
        {
          "id": "williamsburg_bridge",
          "name": "Williamsburg Bridge Bike Path",
          "ja": "ウィリアムズバーグ橋",
          "axis": [
            -0.99184,
            0.12752
          ],
          "ends": [
            [
              3424.9,
              3395.4
            ],
            [
              1278.2,
              3671.4
            ]
          ],
          "towers": [
            [
              2726.34,
              3487.22
            ],
            [
              2241.98,
              3547.88
            ]
          ],
          "mainSpanTowers": [
            0,
            1
          ],
          "towerSource": "bridge_support",
          "towerTop": 94,
          "deckTower": 38,
          "deckMid": 41,
          "mainSpan": 488.1,
          "pieces": 9
        },
        {
          "id": "queensboro_bridge",
          "name": "Ed Koch Queensboro Bridge Upper Level",
          "ja": "クイーンズボロ橋",
          "axis": [
            -0.9961,
            -0.08824
          ],
          "ends": [
            [
              3214.1,
              -1227.9
            ],
            [
              607.9,
              -1458.8
            ]
          ],
          "towers": [
            [
              1859.23,
              -1404.77
            ],
            [
              1558.54,
              -1407.92
            ],
            [
              1367.34,
              -1410.73
            ],
            [
              1006.42,
              -1415.06
            ]
          ],
          "mainSpanTowers": [
            2,
            3
          ],
          "towerSource": "bridge_support",
          "towerTop": 110,
          "deckTower": 39,
          "deckMid": 41,
          "mainSpan": 359.9,
          "pieces": 18
        }
      ],
      "heliports": [
        {
          "id": "heliport_w30",
          "label": "ウエスト 30 丁目ヘリポート",
          "x": -2327.29,
          "z": 927.61,
          "rect": [
            -2410.3,
            826.2,
            -2301.2,
            1051.7
          ]
        },
        {
          "id": "heliport_e34",
          "label": "イースト 34 丁目ヘリポート",
          "x": 939.48,
          "z": 717.87,
          "rect": [
            915.1,
            676.2,
            964.8,
            766.9
          ]
        },
        {
          "id": "heliport_downtown",
          "label": "ダウンタウン・マンハッタン・ヘリポート（6 番桟橋）",
          "x": 448.4,
          "z": 6211.12,
          "rect": [
            347.9,
            6145,
            521.5,
            6276.9
          ]
        }
      ],
      "hotZones": [
        {
          "id": "times_square",
          "label": "タイムズスクエア",
          "x": -886.54,
          "z": -155.37,
          "r": 200,
          "loot": "high"
        },
        {
          "id": "gct",
          "label": "グランド・セントラル",
          "x": 1.21,
          "z": -67.32,
          "r": 160,
          "loot": "high"
        },
        {
          "id": "empire_state",
          "label": "エンパイア・ステート",
          "x": -391.38,
          "z": 684.45,
          "r": 140,
          "loot": "high"
        },
        {
          "id": "rockefeller",
          "label": "ロックフェラー・センター",
          "x": -523.03,
          "z": -602.73,
          "r": 160,
          "loot": "mid"
        },
        {
          "id": "bryant_park",
          "label": "ブライアント・パーク",
          "x": -521.32,
          "z": 81.53,
          "r": 140,
          "loot": "mid"
        },
        {
          "id": "un",
          "label": "国連本部",
          "x": 879.78,
          "z": -81.51,
          "r": 180,
          "loot": "mid"
        },
        {
          "id": "flatiron",
          "label": "フラットアイアン",
          "x": -286.11,
          "z": 1570.6,
          "r": 140,
          "loot": "mid"
        },
        {
          "id": "union_square",
          "label": "ユニオン・スクエア",
          "x": -64.65,
          "z": 2102.85,
          "r": 140,
          "loot": "mid"
        },
        {
          "id": "washington_square",
          "label": "ワシントン・スクエア",
          "x": -328.79,
          "z": 2877.87,
          "r": 140,
          "loot": "mid"
        },
        {
          "id": "hudson_yards",
          "label": "ハドソン・ヤード",
          "x": -1790.59,
          "z": 760.72,
          "r": 220,
          "loot": "high"
        },
        {
          "id": "intrepid",
          "label": "イントレピッド",
          "x": -2394.57,
          "z": -279.23,
          "r": 200,
          "loot": "high"
        },
        {
          "id": "one_wtc",
          "label": "ワン・ワールドトレードセンター",
          "x": -519.09,
          "z": 5254.31,
          "r": 220,
          "loot": "high"
        },
        {
          "id": "wall_street",
          "label": "ウォール街",
          "x": -50.99,
          "z": 5753.63,
          "r": 180,
          "loot": "high"
        },
        {
          "id": "battery_park",
          "label": "バッテリー・パーク",
          "x": -169.06,
          "z": 6321.63,
          "r": 220,
          "loot": "mid"
        },
        {
          "id": "statue_of_liberty",
          "label": "自由の女神",
          "x": -1560.24,
          "z": 8845.54,
          "r": 200,
          "loot": "high"
        },
        {
          "id": "ellis_island",
          "label": "エリス島",
          "x": -1718.56,
          "z": 7677.35,
          "r": 180,
          "loot": "mid"
        },
        {
          "id": "governors_island",
          "label": "ガバナーズ島",
          "x": 346.29,
          "z": 7843.66,
          "r": 400,
          "loot": "mid"
        },
        {
          "id": "brooklyn_bridge_park",
          "label": "ブルックリン・ブリッジ・パーク",
          "x": 1398.53,
          "z": 5981.48,
          "r": 250,
          "loot": "mid"
        },
        {
          "id": "dumbo",
          "label": "ダンボ",
          "x": 1798.34,
          "z": 5202.18,
          "r": 200,
          "loot": "mid"
        },
        {
          "id": "exchange_place",
          "label": "エクスチェンジ・プレイス",
          "x": -2168.57,
          "z": 5748.28,
          "r": 220,
          "loot": "mid"
        },
        {
          "id": "south_street_seaport",
          "label": "サウス・ストリート・シーポート",
          "x": 741.45,
          "z": 5505.12,
          "r": 160,
          "loot": "mid"
        },
        {
          "id": "roosevelt_island",
          "label": "ルーズベルト島",
          "x": 1458.77,
          "z": -2049.73,
          "r": 300,
          "loot": "low"
        },
        {
          "id": "lic",
          "label": "ロングアイランドシティ",
          "x": 2554.94,
          "z": -473.53,
          "r": 300,
          "loot": "mid"
        },
        {
          "id": "chinatown",
          "label": "チャイナタウン",
          "x": 526.99,
          "z": 4319.56,
          "r": 200,
          "loot": "mid"
        },
        {
          "id": "soho",
          "label": "ソーホー",
          "x": -98.25,
          "z": 3713.77,
          "r": 220,
          "loot": "mid"
        }
      ],
      "labels": [
        {
          "ja": "ミッドタウン",
          "en": "Midtown",
          "x": -616.4,
          "z": -10.8
        },
        {
          "ja": "ヘルズ・キッチン",
          "en": "Hell's Kitchen",
          "x": -1671.5,
          "z": -556.1
        },
        {
          "ja": "チェルシー",
          "en": "Chelsea",
          "x": -1449.8,
          "z": 1517.2
        },
        {
          "ja": "グリニッジ・ヴィレッジ",
          "en": "Greenwich Village",
          "x": -851.9,
          "z": 2823.7
        },
        {
          "ja": "イースト・ヴィレッジ",
          "en": "East Village",
          "x": 1096.8,
          "z": 2645.6
        },
        {
          "ja": "ソーホー",
          "en": "SoHo",
          "x": -320,
          "z": 3836.6
        },
        {
          "ja": "トライベッカ",
          "en": "Tribeca",
          "x": -357.4,
          "z": 4745.8
        },
        {
          "ja": "チャイナタウン",
          "en": "Chinatown",
          "x": 527,
          "z": 4319.6
        },
        {
          "ja": "ロウワー・イースト・サイド",
          "en": "Lower East Side",
          "x": 1508.7,
          "z": 3877.3
        },
        {
          "ja": "金融街",
          "en": "Financial District",
          "x": -83.6,
          "z": 5711.3
        },
        {
          "ja": "バッテリー・パーク・シティ",
          "en": "Battery Park City",
          "x": -646.2,
          "z": 5515
        },
        {
          "ja": "マレー・ヒル",
          "en": "Murray Hill",
          "x": 373.5,
          "z": 329.5
        },
        {
          "ja": "グラマシー",
          "en": "Gramercy",
          "x": 320.8,
          "z": 1767.9
        },
        {
          "ja": "アッパー・イースト・サイド",
          "en": "Upper East Side",
          "x": 400.4,
          "z": -2948.6
        },
        {
          "ja": "アッパー・ウエスト・サイド",
          "en": "Upper West Side",
          "x": -1709,
          "z": -3480.7
        },
        {
          "ja": "ルーズベルト島",
          "en": "Roosevelt Island",
          "x": 1458.8,
          "z": -2049.7
        },
        {
          "ja": "ロングアイランドシティ",
          "en": "Long Island City",
          "x": 2554.9,
          "z": -473.5
        },
        {
          "ja": "グリーンポイント",
          "en": "Greenpoint",
          "x": 2940.3,
          "z": 1179.4
        },
        {
          "ja": "ウィリアムズバーグ",
          "en": "Williamsburg",
          "x": 3284.6,
          "z": 3020.1
        },
        {
          "ja": "ダンボ",
          "en": "DUMBO",
          "x": 1798.3,
          "z": 5202.2
        },
        {
          "ja": "ブルックリン・ハイツ",
          "en": "Brooklyn Heights",
          "x": 1740.2,
          "z": 6161.1
        },
        {
          "ja": "ジャージーシティ",
          "en": "Jersey City",
          "x": -2988.5,
          "z": 6011.5
        },
        {
          "ja": "ホーボーケン",
          "en": "Hoboken",
          "x": -3606.1,
          "z": 3028.1
        },
        {
          "ja": "ガバナーズ島",
          "en": "Governors Island",
          "x": 477.8,
          "z": 7685.2
        },
        {
          "ja": "リバティ島",
          "en": "Liberty Island",
          "x": -1626.1,
          "z": 8823.9
        },
        {
          "ja": "エリス島",
          "en": "Ellis Island",
          "x": -1746,
          "z": 7646.6
        },
        {
          "ja": "ハドソン川",
          "en": "Hudson River",
          "x": -2642.9,
          "z": 1733.6
        },
        {
          "ja": "イースト川",
          "en": "East River",
          "x": 1489,
          "z": 1349.1
        },
        {
          "ja": "アッパー湾",
          "en": "Upper Bay",
          "x": 12.3,
          "z": 9148.5
        },
        {
          "ja": "セントラル・パーク",
          "en": "Central Park",
          "x": -610.5,
          "z": -2438.9
        }
      ],
      "counts": {
        "buildings": 42247,
        "parts": 15515,
        "roads": 37922,
        "areas": 13624,
        "lines": 5784,
        "points": 68845
      },
      "railShift": {
        "v": 1,
        "lines": {
          "10_12:0": {
            "sig": "13|2220|3552.53125|2732|3487.34375"
          },
          "10_12:1": {
            "sig": "13|2732|3483.25|2220|3548.59375"
          },
          "11_12:0": {
            "sig": "13|2732|3487.34375|3100|3440.5"
          },
          "11_12:1": {
            "sig": "13|3100|3436.25|2732|3483.25",
            "xz": [
              3099.61962890625,
              3433.274169921875,
              3071.33349609375,
              3439.801513671875,
              3069.4375,
              3440.15625,
              3030,
              3445.1875,
              2990.5625,
              3450.21875,
              2951.125,
              3455.28125,
              2911.6875,
              3460.3125,
              2882.125,
              3464.09375,
              2862.40625,
              3466.59375,
              2832.8125,
              3470.375,
              2813.09375,
              3472.875,
              2773.65625,
              3477.9375,
              2753.9375,
              3480.4375,
              2732,
              3483.25
            ],
            "y": [
              23.360000610351562,
              25.338125228881836,
              25.469999313354492,
              28,
              30.309999465942383,
              32.36000061035156,
              34.119998931884766,
              35.2400016784668,
              35.880001068115234,
              36.689998626708984,
              37.130001068115234,
              37.7400016784668,
              37.90999984741211,
              38.0099983215332
            ]
          },
          "7_14:0": {
            "sig": "11|1196|4671.125|788.65625|4351.78125"
          },
          "7_14:3": {
            "sig": "11|785.5625|4355.875|1196|4677.96875"
          },
          "7_14:5": {
            "sig": "11|776.65625|4367.0625|1177.71875|4680",
            "xz": [
              776.65625,
              4367.0625,
              778.1958618164062,
              4368.32861328125,
              779.6441040039062,
              4369.71142578125,
              781.2149047851562,
              4370.9375,
              782.9083862304688,
              4372.0068359375,
              784.5104370117188,
              4373.19287109375,
              823.78125,
              4403.84375,
              935.71875,
              4491.1875,
              971.0625,
              4518.78125,
              1000.53125,
              4541.75,
              1035.875,
              4569.34375,
              1071.21875,
              4596.90625,
              1106.5625,
              4624.5,
              1136.03125,
              4647.46875,
              1165.5,
              4670.46875,
              1177.71875,
              4680
            ],
            "y": [
              4.71999979019165,
              4.857333183288574,
              4.994666576385498,
              5.131999969482422,
              5.269333362579346,
              5.4066667556762695,
              8.84000015258789,
              19.020000457763672,
              22.09000015258789,
              24.530000686645508,
              27.260000228881836,
              29.760000228881836,
              31.969999313354492,
              33.58000183105469,
              34.959999084472656,
              35.439998626708984
            ]
          },
          "7_14:6": {
            "sig": "11|1183.9375|4680|779.21875|4364.1875"
          },
          "7_15:0": {
            "sig": "3|1177.71875|4680|1196|4694.28125"
          },
          "7_15:1": {
            "sig": "3|1196|4689.40625|1183.9375|4680"
          },
          "8_12:0": {
            "sig": "5|1414.25|3656|1708|3618.09375"
          },
          "8_12:1": {
            "sig": "6|1708|3614.3125|1384.90625|3656"
          },
          "8_13:1": {
            "sig": "6|1278.625|3673.46875|1414.25|3656"
          },
          "8_13:2": {
            "sig": "5|1384.90625|3656|1278.375|3669.6875"
          },
          "8_14:0": {
            "sig": "3|1207.34375|4680|1196|4671.125"
          },
          "8_14:1": {
            "sig": "2|1196|4677.96875|1198.59375|4680"
          },
          "8_15:0": {
            "sig": "18|1708|5072.59375|1207.34375|4680"
          },
          "8_15:1": {
            "sig": "19|1198.59375|4680|1708|5078.125"
          },
          "8_15:2": {
            "sig": "19|1196|4694.28125|1708|5093.78125"
          },
          "8_15:3": {
            "sig": "19|1708|5088.90625|1196|4689.40625"
          },
          "9_12:0": {
            "sig": "14|1708|3618.09375|2220|3552.53125",
            "xz": [
              1708,
              3618.09375,
              1749.4375,
              3612.75,
              1798.5625,
              3606.40625,
              1837.84375,
              3601.3125,
              1886.96875,
              3594.96875,
              1902.706298828125,
              3592.94384765625,
              1904.6800537109375,
              3592.741943359375,
              1906.6724853515625,
              3592.685546875,
              1926.34423828125,
              3590.154296875,
              1957.8839111328125,
              3586.154296875,
              1959.8302001953125,
              3585.70703125,
              1961.7950439453125,
              3585.40625,
              1975.59375,
              3583.65625,
              2015.03125,
              3578.625,
              2054.46875,
              3573.59375,
              2093.90625,
              3568.59375,
              2133.34375,
              3563.5625,
              2172.78125,
              3558.53125,
              2212.21875,
              3553.53125,
              2220,
              3552.53125
            ],
            "y": [
              22.420000076293945,
              24.530000686645508,
              26.899999618530273,
              28.65999984741211,
              30.700000762939453,
              31.288000106811523,
              31.361499786376953,
              31.434999465942383,
              32.16999816894531,
              33.213199615478516,
              33.27840042114258,
              33.343597412109375,
              33.79999923706055,
              34.93000030517578,
              35.88999938964844,
              36.68000030517578,
              37.290000915527344,
              37.709999084472656,
              37.95000076293945,
              37.959999084472656
            ]
          },
          "9_12:1": {
            "sig": "14|2220|3548.59375|1708|3614.3125"
          },
          "9_15:0": {
            "sig": "8|1860.25|5192|1708|5072.59375"
          },
          "9_15:1": {
            "sig": "8|1708|5078.125|1853.15625|5192"
          },
          "9_15:2": {
            "sig": "8|1708|5093.78125|1833.90625|5192"
          },
          "9_15:3": {
            "sig": "8|1840.125|5192|1708|5088.90625"
          },
          "9_16:1": {
            "sig": "12|2176.5625|5440.09375|1860.25|5192"
          },
          "9_16:2": {
            "sig": "12|1853.15625|5192|2174.28125|5442.90625"
          },
          "9_16:4": {
            "sig": "12|1833.90625|5192|2167.03125|5451.9375"
          },
          "9_16:7": {
            "sig": "12|2169.4375|5448.96875|1840.125|5192"
          }
        }
      }
    },
    "levels/ships.json": {
      "version": 1,
      "meta": {
        "source": "sd/models/boats.glb",
        "hash": "b43fbbb81565",
        "nonWalkTags": [
          "rail",
          "windbreak",
          "mast",
          "searchlight",
          "lightbar",
          "boom",
          "stack",
          "funnel",
          "dome",
          "edge",
          "bench",
          "seat",
          "console",
          "helm",
          "bitt",
          "bollard",
          "winch",
          "capstan",
          "knee_brace"
        ]
      },
      "types": {
        "speedboat": {
          "kind": "boat",
          "length": 7.94,
          "beam": 2.64,
          "draft": 0.47,
          "freeboard": 0.84,
          "deckY": 0.34,
          "top": 2.16,
          "bbox": [
            [
              -1.33,
              -0.62,
              -4.14
            ],
            [
              1.33,
              2.16,
              4.07
            ]
          ],
          "boxes": [
            [
              -0.49,
              0.34,
              0.08,
              0.49,
              1.5,
              0.98,
              0,
              "console"
            ],
            [
              -0.31,
              0.34,
              -0.8,
              0.31,
              1,
              -0.14,
              0,
              "seat"
            ],
            [
              -0.31,
              0.34,
              -1.7,
              0.31,
              1,
              -1.04,
              0,
              "seat"
            ]
          ],
          "decks": [
            [
              -0.7,
              -2.95,
              0.7,
              1.5,
              0.34,
              "cockpit"
            ]
          ],
          "ramps": [],
          "edges": [],
          "gaps": [],
          "empties": {
            "bow_spray": [
              0,
              0,
              2.4
            ],
            "engine": [
              0,
              1,
              -3.85
            ],
            "exit_driver": [
              -1.8,
              0,
              -0.5
            ],
            "exit_p1": [
              1.8,
              0,
              -1.4
            ],
            "exit_p2": [
              1.8,
              0,
              2
            ],
            "exit_p3": [
              -1.8,
              0,
              2
            ],
            "headlight_l": [
              0.04,
              1.38,
              0.66
            ],
            "headlight_r": [
              -0.04,
              1.38,
              0.66
            ],
            "light_nav_l": [
              0.075,
              1.04,
              3.46
            ],
            "light_nav_r": [
              -0.075,
              1.04,
              3.46
            ],
            "light_stern": [
              0,
              2.13,
              -2.9
            ],
            "seat_driver": [
              0,
              1.72,
              -0.5
            ],
            "seat_p1": [
              0,
              1.72,
              -1.4
            ],
            "seat_p2": [
              0.4,
              1.3,
              2.2
            ],
            "seat_p3": [
              -0.4,
              1.3,
              2.2
            ],
            "wake_origin": [
              0,
              0,
              -3.75
            ]
          },
          "meshes": [
            "body",
            "glass",
            "outboard",
            "prop"
          ],
          "hull": {
            "halfWidth": 1.32,
            "zBow": 4.09,
            "zStern": -4.24,
            "keelY": -0.47
          },
          "draftMax": 0.62,
          "seats": [
            {
              "node": "seat_driver",
              "exitNode": "exit_driver"
            },
            {
              "node": "seat_p1",
              "exitNode": "exit_p1"
            },
            {
              "node": "seat_p2",
              "exitNode": "exit_p2"
            },
            {
              "node": "seat_p3",
              "exitNode": "exit_p3"
            }
          ],
          "outboards": [
            "outboard"
          ],
          "props": [
            "prop"
          ],
          "rudders": [],
          "glass": [
            "glass"
          ],
          "lid": {
            "y": 0.78,
            "poly": [
              [
                1.2804,
                -4.12
              ],
              [
                1.28,
                0.88
              ],
              [
                1.24,
                1.39
              ],
              [
                1.17,
                1.9
              ],
              [
                1.05,
                2.41
              ],
              [
                0.89,
                2.92
              ],
              [
                0.65,
                3.43
              ],
              [
                0,
                3.94
              ],
              [
                -0.65,
                3.43
              ],
              [
                -0.89,
                2.92
              ],
              [
                -1.05,
                2.41
              ],
              [
                -1.17,
                1.9
              ],
              [
                -1.24,
                1.39
              ],
              [
                -1.28,
                0.88
              ],
              [
                -1.28,
                -4.12
              ]
            ]
          }
        },
        "patrol_boat": {
          "kind": "boat",
          "length": 12.2,
          "beam": 4.08,
          "draft": 0.64,
          "freeboard": 1.15,
          "deckY": 0.75,
          "top": 5.02,
          "bbox": [
            [
              -2.03,
              -0.73,
              -6.2
            ],
            [
              2.03,
              5.02,
              6.32
            ]
          ],
          "boxes": [
            [
              -1.61,
              1.16,
              -3.65,
              -1.55,
              1.75,
              -1.92,
              2,
              "rail"
            ],
            [
              1.55,
              1.16,
              -3.65,
              1.61,
              1.75,
              -1.92,
              2,
              "rail"
            ],
            [
              1.34,
              1.37,
              2.52,
              1.44,
              2.17,
              3.11,
              2,
              "rail"
            ],
            [
              1.24,
              1.37,
              3.11,
              1.34,
              2.17,
              3.71,
              2,
              "rail"
            ],
            [
              1.1,
              1.37,
              3.71,
              1.24,
              2.17,
              4.21,
              2,
              "rail"
            ],
            [
              0.96,
              1.37,
              4.21,
              1.1,
              2.17,
              4.71,
              2,
              "rail"
            ],
            [
              0.64,
              1.37,
              4.71,
              0.96,
              2.17,
              5.09,
              2,
              "rail"
            ],
            [
              0.31,
              1.37,
              5.09,
              0.64,
              2.17,
              5.48,
              2,
              "rail"
            ],
            [
              -0.31,
              1.37,
              5.45,
              0.32,
              2.17,
              5.51,
              2,
              "rail"
            ],
            [
              -0.64,
              1.37,
              5.09,
              -0.31,
              2.17,
              5.48,
              2,
              "rail"
            ],
            [
              -0.96,
              1.37,
              4.71,
              -0.64,
              2.17,
              5.09,
              2,
              "rail"
            ],
            [
              -1.1,
              1.37,
              4.21,
              -0.96,
              2.17,
              4.71,
              2,
              "rail"
            ],
            [
              -1.24,
              1.37,
              3.71,
              -1.1,
              2.17,
              4.21,
              2,
              "rail"
            ],
            [
              -1.34,
              1.37,
              3.11,
              -1.24,
              2.17,
              3.71,
              2,
              "rail"
            ],
            [
              -1.44,
              1.37,
              2.52,
              -1.34,
              2.17,
              3.11,
              2,
              "rail"
            ],
            [
              -1.38,
              0.75,
              -1.26,
              1.38,
              2.82,
              1.95,
              4,
              "pilothouse"
            ],
            [
              -0.9,
              0.75,
              -5,
              0.9,
              1.28,
              -4.4,
              0,
              "bench"
            ],
            [
              -0.58,
              0.75,
              -3.4,
              0.58,
              1.35,
              -3.2,
              0,
              "bitt"
            ],
            [
              -0.71,
              0.75,
              0.36,
              -0.19,
              2,
              0.92,
              0,
              "seat"
            ],
            [
              0.19,
              0.75,
              0.36,
              0.71,
              2,
              0.92,
              0,
              "seat"
            ],
            [
              -0.3,
              1.42,
              3.6,
              0.3,
              1.72,
              4.1,
              4,
              "hatch"
            ],
            [
              -0.96,
              2.82,
              -0.96,
              0.96,
              5.05,
              -0.2,
              0,
              "mast"
            ],
            [
              -1.05,
              2.82,
              0.76,
              -0.85,
              3.2,
              1.04,
              0,
              "searchlight"
            ],
            [
              0.85,
              2.82,
              0.76,
              1.05,
              3.2,
              1.04,
              0,
              "searchlight"
            ]
          ],
          "decks": [
            [
              -1.3,
              -5.3,
              1.3,
              -1.3,
              0.75,
              "aft_deck"
            ],
            [
              -1.25,
              -1.15,
              1.25,
              1.2,
              0.75,
              "pilothouse"
            ],
            [
              -1.1,
              2.3,
              1.1,
              4.8,
              1.42,
              "foredeck"
            ],
            [
              -1.38,
              -1.3,
              1.38,
              1,
              2.82,
              "pilothouse_roof"
            ]
          ],
          "ramps": [],
          "edges": [],
          "gaps": [],
          "empties": {
            "bow_spray": [
              0,
              0,
              3.6
            ],
            "engine": [
              0,
              1.25,
              -5.9
            ],
            "exit_driver": [
              -2.5,
              0,
              0.8
            ],
            "exit_p1": [
              2.5,
              0,
              0.8
            ],
            "exit_p2": [
              2.5,
              0,
              -3
            ],
            "exit_p3": [
              -2.5,
              0,
              -3
            ],
            "exit_p4": [
              2.4,
              0,
              3.6
            ],
            "headlight_l": [
              0.95,
              3.1,
              1.06
            ],
            "headlight_r": [
              -0.95,
              3.1,
              1.06
            ],
            "light_mast": [
              0,
              5,
              -0.55
            ],
            "light_nav_l": [
              1.294,
              2.55,
              0.9
            ],
            "light_nav_r": [
              -1.294,
              2.55,
              0.9
            ],
            "light_stern": [
              0,
              1.42,
              -5.47
            ],
            "seat_driver": [
              -0.45,
              2.02,
              0.75
            ],
            "seat_p1": [
              0.45,
              2.02,
              0.75
            ],
            "seat_p2": [
              0.85,
              2.4,
              -3
            ],
            "seat_p3": [
              -0.85,
              2.4,
              -3
            ],
            "seat_p4": [
              0,
              3.05,
              3.6
            ],
            "wake_origin": [
              0,
              0,
              -6.1
            ]
          },
          "meshes": [
            "body",
            "glass",
            "outboard_l",
            "prop_l",
            "outboard_r",
            "prop_r"
          ],
          "hull": {
            "halfWidth": 2.04,
            "zBow": 6.36,
            "zStern": -6.25,
            "keelY": -0.64
          },
          "draftMax": 0.725,
          "seats": [
            {
              "node": "seat_driver",
              "exitNode": "exit_driver"
            },
            {
              "node": "seat_p1",
              "exitNode": "exit_p1"
            },
            {
              "node": "seat_p2",
              "exitNode": "exit_p2"
            },
            {
              "node": "seat_p3",
              "exitNode": "exit_p3"
            },
            {
              "node": "seat_p4",
              "exitNode": "exit_p4"
            }
          ],
          "outboards": [
            "outboard_l",
            "outboard_r"
          ],
          "props": [
            "prop_l",
            "prop_r"
          ],
          "rudders": [],
          "glass": [
            "glass"
          ],
          "lid": {
            "y": 1.09,
            "poly": [
              [
                1.9788,
                -6.13
              ],
              [
                1.98,
                1.52
              ],
              [
                1.92,
                2.3
              ],
              [
                1.8,
                3.08
              ],
              [
                1.63,
                3.87
              ],
              [
                1.38,
                4.65
              ],
              [
                1,
                5.43
              ],
              [
                0,
                6.21
              ],
              [
                -1,
                5.43
              ],
              [
                -1.38,
                4.65
              ],
              [
                -1.63,
                3.87
              ],
              [
                -1.8,
                3.08
              ],
              [
                -1.92,
                2.3
              ],
              [
                -1.98,
                1.52
              ],
              [
                -1.98,
                -6.13
              ]
            ]
          }
        },
        "water_taxi": {
          "kind": "boat",
          "length": 14.95,
          "beam": 4.36,
          "draft": 1.05,
          "freeboard": 1.38,
          "deckY": 1,
          "top": 4.48,
          "bbox": [
            [
              -2.29,
              -1.05,
              -7.36
            ],
            [
              2.29,
              4.48,
              7.73
            ]
          ],
          "boxes": [
            [
              -1.55,
              1,
              -6.98,
              1.55,
              2.05,
              -6.45,
              0,
              "bench"
            ],
            [
              -1.7,
              1,
              -1.3,
              -1.15,
              2,
              3,
              0,
              "bench"
            ],
            [
              1.15,
              1,
              -1.3,
              1.7,
              2,
              3,
              0,
              "bench"
            ],
            [
              -0.65,
              1,
              3.72,
              0.65,
              2.3,
              4.55,
              0,
              "helm"
            ],
            [
              -0.28,
              1,
              3.12,
              0.28,
              2.3,
              3.7,
              0,
              "seat"
            ],
            [
              -0.6,
              3.1,
              4,
              0.6,
              3.3,
              4.2,
              0,
              "lightbar"
            ],
            [
              -0.06,
              3.1,
              0.94,
              0.06,
              4.5,
              1.06,
              0,
              "mast"
            ]
          ],
          "decks": [
            [
              -1.6,
              -7,
              1.6,
              -1.7,
              1,
              "aft_deck"
            ],
            [
              -1.6,
              -1.5,
              1.6,
              3.8,
              1,
              "cabin"
            ],
            [
              -0.9,
              5,
              0.9,
              6.6,
              1,
              "foredeck"
            ],
            [
              -1.8,
              -1.8,
              1.8,
              4.5,
              3.1,
              "cabin_roof"
            ]
          ],
          "ramps": [],
          "edges": [],
          "gaps": [],
          "empties": {
            "bow_spray": [
              0,
              0,
              6.9
            ],
            "engine": [
              0,
              1.2,
              -4.6
            ],
            "exhaust": [
              0.9,
              0.45,
              -7.32
            ],
            "exit_driver": [
              -2.8,
              0,
              3.4
            ],
            "exit_p1": [
              2.8,
              0,
              2.2
            ],
            "exit_p2": [
              -2.8,
              0,
              2.2
            ],
            "exit_p3": [
              2.8,
              0,
              0
            ],
            "exit_p4": [
              -2.8,
              0,
              0
            ],
            "exit_p5": [
              2.7,
              0,
              -5.5
            ],
            "exit_p6": [
              -2.7,
              0,
              -5.5
            ],
            "headlight_l": [
              0.06,
              3.24,
              4.22
            ],
            "headlight_r": [
              -0.06,
              3.24,
              4.22
            ],
            "light_mast": [
              0,
              4.45,
              1
            ],
            "light_nav_l": [
              1.695,
              2.85,
              3.6
            ],
            "light_nav_r": [
              -1.695,
              2.85,
              3.6
            ],
            "light_stern": [
              0,
              1.32,
              -7.321
            ],
            "seat_driver": [
              0,
              2.72,
              3.45
            ],
            "seat_p1": [
              1.38,
              2.25,
              2.2
            ],
            "seat_p2": [
              -1.38,
              2.25,
              2.2
            ],
            "seat_p3": [
              1.38,
              2.25,
              0
            ],
            "seat_p4": [
              -1.38,
              2.25,
              0
            ],
            "seat_p5": [
              0.8,
              2.25,
              -6.6
            ],
            "seat_p6": [
              -0.8,
              2.25,
              -6.6
            ],
            "wake_origin": [
              0,
              0,
              -7.4
            ]
          },
          "meshes": [
            "body",
            "glass",
            "prop",
            "rudder"
          ],
          "hull": {
            "halfWidth": 2.18,
            "zBow": 7.62,
            "zStern": -7.32,
            "keelY": -1.05
          },
          "draftMax": 1.05,
          "seats": [
            {
              "node": "seat_driver",
              "exitNode": "exit_driver"
            },
            {
              "node": "seat_p1",
              "exitNode": "exit_p1"
            },
            {
              "node": "seat_p2",
              "exitNode": "exit_p2"
            },
            {
              "node": "seat_p3",
              "exitNode": "exit_p3"
            },
            {
              "node": "seat_p4",
              "exitNode": "exit_p4"
            },
            {
              "node": "seat_p5",
              "exitNode": "exit_p5"
            },
            {
              "node": "seat_p6",
              "exitNode": "exit_p6"
            }
          ],
          "outboards": [],
          "props": [
            "prop"
          ],
          "rudders": [
            "rudder"
          ],
          "glass": [
            "glass"
          ],
          "lid": {
            "y": 1.32,
            "poly": [
              [
                2.1146000000000003,
                -7.2
              ],
              [
                2.11,
                1.9
              ],
              [
                2.05,
                2.82
              ],
              [
                1.93,
                3.75
              ],
              [
                1.74,
                4.68
              ],
              [
                1.47,
                5.61
              ],
              [
                1.07,
                6.54
              ],
              [
                0,
                7.47
              ],
              [
                -1.07,
                6.54
              ],
              [
                -1.47,
                5.61
              ],
              [
                -1.74,
                4.68
              ],
              [
                -1.93,
                3.75
              ],
              [
                -2.05,
                2.82
              ],
              [
                -2.11,
                1.9
              ],
              [
                -2.11,
                -7.2
              ]
            ]
          }
        },
        "ferry_orange": {
          "kind": "ship",
          "length": 94,
          "beam": 22.6,
          "draft": 4.2,
          "freeboard": 3.6,
          "deckY": 3.6,
          "top": 23.23,
          "bbox": [
            [
              -11.33,
              -4.2,
              -47
            ],
            [
              11.33,
              23.23,
              47
            ]
          ],
          "boxes": [
            [
              4.91,
              13.6,
              16.9,
              5.75,
              14.6,
              17.25,
              2,
              "rail"
            ],
            [
              5.75,
              13.6,
              17.25,
              6.1,
              14.6,
              18.07,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              18.07,
              6.13,
              14.6,
              18.95,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              18.95,
              6.13,
              14.6,
              19.82,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              19.82,
              6.13,
              14.6,
              20.7,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              20.7,
              6.13,
              14.6,
              21.57,
              2,
              "rail"
            ],
            [
              5.72,
              13.6,
              21.57,
              6.1,
              14.6,
              22.46,
              2,
              "rail"
            ],
            [
              5.34,
              13.6,
              22.46,
              5.72,
              14.6,
              23.34,
              2,
              "rail"
            ],
            [
              4.44,
              13.6,
              23.34,
              5.34,
              14.6,
              23.72,
              2,
              "rail"
            ],
            [
              3.54,
              13.6,
              23.72,
              4.44,
              14.6,
              24.1,
              2,
              "rail"
            ],
            [
              -3.54,
              13.6,
              24.07,
              3.54,
              14.6,
              24.13,
              2,
              "rail"
            ],
            [
              -4.44,
              13.6,
              23.72,
              -3.54,
              14.6,
              24.1,
              2,
              "rail"
            ],
            [
              -5.34,
              13.6,
              23.34,
              -4.44,
              14.6,
              23.72,
              2,
              "rail"
            ],
            [
              -5.72,
              13.6,
              22.46,
              -5.34,
              14.6,
              23.34,
              2,
              "rail"
            ],
            [
              -6.1,
              13.6,
              21.57,
              -5.72,
              14.6,
              22.46,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              20.7,
              -6.07,
              14.6,
              21.57,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              19.82,
              -6.07,
              14.6,
              20.7,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              18.95,
              -6.07,
              14.6,
              19.82,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              18.07,
              -6.07,
              14.6,
              18.95,
              2,
              "rail"
            ],
            [
              -6.1,
              13.6,
              17.25,
              -5.75,
              14.6,
              18.07,
              2,
              "rail"
            ],
            [
              -5.75,
              13.6,
              16.9,
              -4.91,
              14.6,
              17.25,
              2,
              "rail"
            ],
            [
              -4.91,
              13.6,
              16.87,
              4.91,
              14.6,
              16.93,
              2,
              "rail"
            ],
            [
              -5.5,
              13.6,
              17.5,
              5.5,
              16.7,
              23.5,
              4,
              "wheelhouse"
            ],
            [
              -0.17,
              16.7,
              19.83,
              0.17,
              23.2,
              20.17,
              0,
              "mast"
            ],
            [
              4.91,
              13.6,
              -17.25,
              5.75,
              14.6,
              -16.9,
              2,
              "rail"
            ],
            [
              5.75,
              13.6,
              -18.07,
              6.1,
              14.6,
              -17.25,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              -18.95,
              6.13,
              14.6,
              -18.07,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              -19.82,
              6.13,
              14.6,
              -18.95,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              -20.7,
              6.13,
              14.6,
              -19.82,
              2,
              "rail"
            ],
            [
              6.07,
              13.6,
              -21.57,
              6.13,
              14.6,
              -20.7,
              2,
              "rail"
            ],
            [
              5.72,
              13.6,
              -22.46,
              6.1,
              14.6,
              -21.57,
              2,
              "rail"
            ],
            [
              5.34,
              13.6,
              -23.34,
              5.72,
              14.6,
              -22.46,
              2,
              "rail"
            ],
            [
              4.44,
              13.6,
              -23.72,
              5.34,
              14.6,
              -23.34,
              2,
              "rail"
            ],
            [
              3.54,
              13.6,
              -24.1,
              4.44,
              14.6,
              -23.72,
              2,
              "rail"
            ],
            [
              -3.54,
              13.6,
              -24.13,
              3.54,
              14.6,
              -24.07,
              2,
              "rail"
            ],
            [
              -4.44,
              13.6,
              -24.1,
              -3.54,
              14.6,
              -23.72,
              2,
              "rail"
            ],
            [
              -5.34,
              13.6,
              -23.72,
              -4.44,
              14.6,
              -23.34,
              2,
              "rail"
            ],
            [
              -5.72,
              13.6,
              -23.34,
              -5.34,
              14.6,
              -22.46,
              2,
              "rail"
            ],
            [
              -6.1,
              13.6,
              -22.46,
              -5.72,
              14.6,
              -21.57,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              -21.57,
              -6.07,
              14.6,
              -20.7,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              -20.7,
              -6.07,
              14.6,
              -19.82,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              -19.82,
              -6.07,
              14.6,
              -18.95,
              2,
              "rail"
            ],
            [
              -6.13,
              13.6,
              -18.95,
              -6.07,
              14.6,
              -18.07,
              2,
              "rail"
            ],
            [
              -6.1,
              13.6,
              -18.07,
              -5.75,
              14.6,
              -17.25,
              2,
              "rail"
            ],
            [
              -5.75,
              13.6,
              -17.25,
              -4.91,
              14.6,
              -16.9,
              2,
              "rail"
            ],
            [
              -4.91,
              13.6,
              -16.93,
              4.91,
              14.6,
              -16.87,
              2,
              "rail"
            ],
            [
              -5.5,
              13.6,
              -23.5,
              5.5,
              16.7,
              -17.5,
              4,
              "wheelhouse"
            ],
            [
              -0.17,
              16.7,
              -20.17,
              0.17,
              23.2,
              -19.83,
              0,
              "mast"
            ],
            [
              3.5,
              7.2,
              -39.88,
              6.19,
              8.3,
              -39.82,
              2,
              "rail"
            ],
            [
              6.19,
              7.2,
              -39.85,
              6.98,
              8.3,
              -39.52,
              2,
              "rail"
            ],
            [
              6.98,
              7.2,
              -39.52,
              7.77,
              8.3,
              -39.19,
              2,
              "rail"
            ],
            [
              7.77,
              7.2,
              -39.19,
              8.56,
              8.3,
              -38.86,
              2,
              "rail"
            ],
            [
              8.56,
              7.2,
              -38.86,
              8.7,
              8.3,
              -38.77,
              2,
              "rail"
            ],
            [
              8.7,
              7.2,
              -38.77,
              9.01,
              8.3,
              -37.94,
              2,
              "rail"
            ],
            [
              9.01,
              7.2,
              -37.94,
              9.32,
              8.3,
              -37.11,
              2,
              "rail"
            ],
            [
              9.32,
              7.2,
              -37.11,
              9.63,
              8.3,
              -36.28,
              2,
              "rail"
            ],
            [
              9.63,
              7.2,
              -36.28,
              9.94,
              8.3,
              -35.45,
              2,
              "rail"
            ],
            [
              9.94,
              7.2,
              -35.45,
              10.05,
              8.3,
              -35,
              2,
              "rail"
            ],
            [
              10.02,
              7.2,
              -35,
              10.08,
              8.3,
              35,
              2,
              "rail"
            ],
            [
              9.94,
              7.2,
              35,
              10.05,
              8.3,
              35.45,
              2,
              "rail"
            ],
            [
              9.63,
              7.2,
              35.45,
              9.94,
              8.3,
              36.28,
              2,
              "rail"
            ],
            [
              9.32,
              7.2,
              36.28,
              9.63,
              8.3,
              37.11,
              2,
              "rail"
            ],
            [
              9.01,
              7.2,
              37.11,
              9.32,
              8.3,
              37.94,
              2,
              "rail"
            ],
            [
              8.7,
              7.2,
              37.94,
              9.01,
              8.3,
              38.77,
              2,
              "rail"
            ],
            [
              8.56,
              7.2,
              38.77,
              8.7,
              8.3,
              38.86,
              2,
              "rail"
            ],
            [
              7.77,
              7.2,
              38.86,
              8.56,
              8.3,
              39.19,
              2,
              "rail"
            ],
            [
              6.98,
              7.2,
              39.19,
              7.77,
              8.3,
              39.52,
              2,
              "rail"
            ],
            [
              6.19,
              7.2,
              39.52,
              6.98,
              8.3,
              39.85,
              2,
              "rail"
            ],
            [
              3.5,
              7.2,
              39.82,
              6.19,
              8.3,
              39.88,
              2,
              "rail"
            ],
            [
              -1.9,
              7.2,
              39.82,
              1.9,
              8.3,
              39.88,
              2,
              "rail"
            ],
            [
              -6.19,
              7.2,
              39.82,
              -3.5,
              8.3,
              39.88,
              2,
              "rail"
            ],
            [
              -6.98,
              7.2,
              39.52,
              -6.19,
              8.3,
              39.85,
              2,
              "rail"
            ],
            [
              -7.77,
              7.2,
              39.19,
              -6.98,
              8.3,
              39.52,
              2,
              "rail"
            ],
            [
              -8.56,
              7.2,
              38.86,
              -7.77,
              8.3,
              39.19,
              2,
              "rail"
            ],
            [
              -8.7,
              7.2,
              38.77,
              -8.56,
              8.3,
              38.86,
              2,
              "rail"
            ],
            [
              -9.01,
              7.2,
              37.94,
              -8.7,
              8.3,
              38.77,
              2,
              "rail"
            ],
            [
              -9.32,
              7.2,
              37.11,
              -9.01,
              8.3,
              37.94,
              2,
              "rail"
            ],
            [
              -9.63,
              7.2,
              36.28,
              -9.32,
              8.3,
              37.11,
              2,
              "rail"
            ],
            [
              -9.94,
              7.2,
              35.45,
              -9.63,
              8.3,
              36.28,
              2,
              "rail"
            ],
            [
              -10.05,
              7.2,
              35,
              -9.94,
              8.3,
              35.45,
              2,
              "rail"
            ],
            [
              -10.08,
              7.2,
              -35,
              -10.02,
              8.3,
              35,
              2,
              "rail"
            ],
            [
              -10.05,
              7.2,
              -35.45,
              -9.94,
              8.3,
              -35,
              2,
              "rail"
            ],
            [
              -9.94,
              7.2,
              -36.28,
              -9.63,
              8.3,
              -35.45,
              2,
              "rail"
            ],
            [
              -9.63,
              7.2,
              -37.11,
              -9.32,
              8.3,
              -36.28,
              2,
              "rail"
            ],
            [
              -9.32,
              7.2,
              -37.94,
              -9.01,
              8.3,
              -37.11,
              2,
              "rail"
            ],
            [
              -9.01,
              7.2,
              -38.77,
              -8.7,
              8.3,
              -37.94,
              2,
              "rail"
            ],
            [
              -8.7,
              7.2,
              -38.86,
              -8.56,
              8.3,
              -38.77,
              2,
              "rail"
            ],
            [
              -8.56,
              7.2,
              -39.19,
              -7.77,
              8.3,
              -38.86,
              2,
              "rail"
            ],
            [
              -7.77,
              7.2,
              -39.52,
              -6.98,
              8.3,
              -39.19,
              2,
              "rail"
            ],
            [
              -6.98,
              7.2,
              -39.85,
              -6.19,
              8.3,
              -39.52,
              2,
              "rail"
            ],
            [
              -6.19,
              7.2,
              -39.88,
              -3.5,
              8.3,
              -39.82,
              2,
              "rail"
            ],
            [
              -1.9,
              7.2,
              -39.88,
              1.9,
              8.3,
              -39.82,
              2,
              "rail"
            ],
            [
              5.3,
              10.6,
              -33.84,
              6.21,
              11.7,
              -33.47,
              2,
              "rail"
            ],
            [
              6.21,
              10.6,
              -33.47,
              7.11,
              11.7,
              -33.1,
              2,
              "rail"
            ],
            [
              7.12,
              10.6,
              -33.1,
              8.02,
              11.7,
              -32.72,
              2,
              "rail"
            ],
            [
              8.02,
              10.6,
              -32.72,
              8.4,
              11.7,
              -31.81,
              2,
              "rail"
            ],
            [
              8.4,
              10.6,
              -31.81,
              8.77,
              11.7,
              -30.91,
              2,
              "rail"
            ],
            [
              8.77,
              10.6,
              -30.9,
              9.15,
              11.7,
              -30,
              2,
              "rail"
            ],
            [
              9.12,
              10.6,
              -30,
              9.18,
              11.7,
              30,
              2,
              "rail"
            ],
            [
              8.77,
              10.6,
              30,
              9.15,
              11.7,
              30.91,
              2,
              "rail"
            ],
            [
              8.4,
              10.6,
              30.91,
              8.77,
              11.7,
              31.81,
              2,
              "rail"
            ],
            [
              8.02,
              10.6,
              31.81,
              8.4,
              11.7,
              32.72,
              2,
              "rail"
            ],
            [
              7.12,
              10.6,
              32.72,
              8.02,
              11.7,
              33.1,
              2,
              "rail"
            ],
            [
              6.21,
              10.6,
              33.1,
              7.11,
              11.7,
              33.47,
              2,
              "rail"
            ],
            [
              5.3,
              10.6,
              33.47,
              6.21,
              11.7,
              33.85,
              2,
              "rail"
            ],
            [
              -3.9,
              10.6,
              33.82,
              3.9,
              11.7,
              33.88,
              2,
              "rail"
            ],
            [
              -6.21,
              10.6,
              33.47,
              -5.3,
              11.7,
              33.85,
              2,
              "rail"
            ],
            [
              -7.11,
              10.6,
              33.1,
              -6.21,
              11.7,
              33.47,
              2,
              "rail"
            ],
            [
              -8.02,
              10.6,
              32.72,
              -7.12,
              11.7,
              33.1,
              2,
              "rail"
            ],
            [
              -8.4,
              10.6,
              31.81,
              -8.02,
              11.7,
              32.72,
              2,
              "rail"
            ],
            [
              -8.77,
              10.6,
              30.91,
              -8.4,
              11.7,
              31.81,
              2,
              "rail"
            ],
            [
              -9.15,
              10.6,
              30,
              -8.77,
              11.7,
              30.91,
              2,
              "rail"
            ],
            [
              -9.18,
              10.6,
              -30,
              -9.12,
              11.7,
              30,
              2,
              "rail"
            ],
            [
              -9.15,
              10.6,
              -30.9,
              -8.77,
              11.7,
              -30,
              2,
              "rail"
            ],
            [
              -8.77,
              10.6,
              -31.81,
              -8.4,
              11.7,
              -30.91,
              2,
              "rail"
            ],
            [
              -8.4,
              10.6,
              -32.72,
              -8.02,
              11.7,
              -31.81,
              2,
              "rail"
            ],
            [
              -8.02,
              10.6,
              -33.1,
              -7.12,
              11.7,
              -32.72,
              2,
              "rail"
            ],
            [
              -7.11,
              10.6,
              -33.47,
              -6.21,
              11.7,
              -33.1,
              2,
              "rail"
            ],
            [
              -6.21,
              10.6,
              -33.84,
              -5.3,
              11.7,
              -33.47,
              2,
              "rail"
            ],
            [
              -3.9,
              10.6,
              -33.88,
              3.9,
              11.7,
              -33.82,
              2,
              "rail"
            ],
            [
              3.7,
              13.6,
              -25.88,
              3.98,
              14.7,
              -25.82,
              2,
              "rail"
            ],
            [
              3.98,
              13.6,
              -25.85,
              4.9,
              14.7,
              -25.47,
              2,
              "rail"
            ],
            [
              4.9,
              13.6,
              -25.47,
              5.81,
              14.7,
              -25.1,
              2,
              "rail"
            ],
            [
              5.81,
              13.6,
              -25.1,
              6.72,
              14.7,
              -24.72,
              2,
              "rail"
            ],
            [
              6.72,
              13.6,
              -24.72,
              7.1,
              14.7,
              -23.81,
              2,
              "rail"
            ],
            [
              7.1,
              13.6,
              -23.81,
              7.47,
              14.7,
              -22.9,
              2,
              "rail"
            ],
            [
              7.47,
              13.6,
              -22.91,
              7.85,
              14.7,
              -22,
              2,
              "rail"
            ],
            [
              7.82,
              13.6,
              -22,
              7.88,
              14.7,
              22,
              2,
              "rail"
            ],
            [
              7.47,
              13.6,
              22,
              7.85,
              14.7,
              22.91,
              2,
              "rail"
            ],
            [
              7.1,
              13.6,
              22.9,
              7.47,
              14.7,
              23.81,
              2,
              "rail"
            ],
            [
              6.72,
              13.6,
              23.81,
              7.1,
              14.7,
              24.72,
              2,
              "rail"
            ],
            [
              5.81,
              13.6,
              24.72,
              6.72,
              14.7,
              25.1,
              2,
              "rail"
            ],
            [
              4.9,
              13.6,
              25.1,
              5.81,
              14.7,
              25.48,
              2,
              "rail"
            ],
            [
              3.98,
              13.6,
              25.48,
              4.9,
              14.7,
              25.85,
              2,
              "rail"
            ],
            [
              3.7,
              13.6,
              25.82,
              3.98,
              14.7,
              25.88,
              2,
              "rail"
            ],
            [
              -3.98,
              13.6,
              25.82,
              2.3,
              14.7,
              25.88,
              2,
              "rail"
            ],
            [
              -4.9,
              13.6,
              25.48,
              -3.98,
              14.7,
              25.85,
              2,
              "rail"
            ],
            [
              -5.81,
              13.6,
              25.1,
              -4.9,
              14.7,
              25.48,
              2,
              "rail"
            ],
            [
              -6.72,
              13.6,
              24.72,
              -5.81,
              14.7,
              25.1,
              2,
              "rail"
            ],
            [
              -7.1,
              13.6,
              23.81,
              -6.72,
              14.7,
              24.72,
              2,
              "rail"
            ],
            [
              -7.47,
              13.6,
              22.9,
              -7.1,
              14.7,
              23.81,
              2,
              "rail"
            ],
            [
              -7.85,
              13.6,
              22,
              -7.47,
              14.7,
              22.91,
              2,
              "rail"
            ],
            [
              -7.88,
              13.6,
              -22,
              -7.82,
              14.7,
              22,
              2,
              "rail"
            ],
            [
              -7.85,
              13.6,
              -22.91,
              -7.47,
              14.7,
              -22,
              2,
              "rail"
            ],
            [
              -7.47,
              13.6,
              -23.81,
              -7.1,
              14.7,
              -22.9,
              2,
              "rail"
            ],
            [
              -7.1,
              13.6,
              -24.72,
              -6.72,
              14.7,
              -23.81,
              2,
              "rail"
            ],
            [
              -6.72,
              13.6,
              -25.1,
              -5.81,
              14.7,
              -24.72,
              2,
              "rail"
            ],
            [
              -5.81,
              13.6,
              -25.47,
              -4.9,
              14.7,
              -25.1,
              2,
              "rail"
            ],
            [
              -4.9,
              13.6,
              -25.85,
              -3.98,
              14.7,
              -25.47,
              2,
              "rail"
            ],
            [
              -3.98,
              13.6,
              -25.88,
              2.3,
              14.7,
              -25.82,
              2,
              "rail"
            ],
            [
              4.75,
              3.6,
              42.25,
              5.25,
              4.3,
              42.75,
              0,
              "bollard"
            ],
            [
              -5.25,
              3.6,
              42.25,
              -4.75,
              4.3,
              42.75,
              0,
              "bollard"
            ],
            [
              4.75,
              3.6,
              -42.75,
              5.25,
              4.3,
              -42.25,
              0,
              "bollard"
            ],
            [
              -5.25,
              3.6,
              -42.75,
              -4.75,
              4.3,
              -42.25,
              0,
              "bollard"
            ],
            [
              -5.6,
              13.6,
              -12.28,
              -3.4,
              14.55,
              -11.77,
              0,
              "bench"
            ],
            [
              -2.7,
              13.6,
              -12.28,
              -0.5,
              14.55,
              -11.77,
              0,
              "bench"
            ],
            [
              0.5,
              13.6,
              -12.28,
              2.7,
              14.55,
              -11.77,
              0,
              "bench"
            ],
            [
              3.4,
              13.6,
              -12.28,
              5.6,
              14.55,
              -11.77,
              0,
              "bench"
            ],
            [
              -5.6,
              13.6,
              -8.28,
              -3.4,
              14.55,
              -7.77,
              0,
              "bench"
            ],
            [
              -2.7,
              13.6,
              -8.28,
              -0.5,
              14.55,
              -7.77,
              0,
              "bench"
            ],
            [
              0.5,
              13.6,
              -8.28,
              2.7,
              14.55,
              -7.77,
              0,
              "bench"
            ],
            [
              3.4,
              13.6,
              -8.28,
              5.6,
              14.55,
              -7.77,
              0,
              "bench"
            ],
            [
              -5.6,
              13.6,
              7.72,
              -3.4,
              14.55,
              8.23,
              0,
              "bench"
            ],
            [
              -2.7,
              13.6,
              7.72,
              -0.5,
              14.55,
              8.23,
              0,
              "bench"
            ],
            [
              0.5,
              13.6,
              7.72,
              2.7,
              14.55,
              8.23,
              0,
              "bench"
            ],
            [
              3.4,
              13.6,
              7.72,
              5.6,
              14.55,
              8.23,
              0,
              "bench"
            ],
            [
              -5.6,
              13.6,
              11.72,
              -3.4,
              14.55,
              12.23,
              0,
              "bench"
            ],
            [
              -2.7,
              13.6,
              11.72,
              -0.5,
              14.55,
              12.23,
              0,
              "bench"
            ],
            [
              0.5,
              13.6,
              11.72,
              2.7,
              14.55,
              12.23,
              0,
              "bench"
            ],
            [
              3.4,
              13.6,
              11.72,
              5.6,
              14.55,
              12.23,
              0,
              "bench"
            ],
            [
              -10.6,
              -4.2,
              -46,
              10.6,
              3.6,
              46,
              4,
              "deck_main"
            ],
            [
              -10.2,
              3.6,
              -40,
              10.2,
              7.2,
              40,
              4,
              "deck2_house"
            ],
            [
              -9.3,
              7.2,
              -34,
              9.3,
              10.6,
              34,
              4,
              "deck3_house"
            ],
            [
              -8,
              10.6,
              -26,
              8,
              13.6,
              26,
              4,
              "top_house"
            ],
            [
              -2.4,
              13.6,
              -3.6,
              2.4,
              20.2,
              3.6,
              0,
              "funnel"
            ]
          ],
          "decks": [
            [
              -5.5,
              18.1,
              5.5,
              22.9,
              16.7,
              "wheelhouse_roof_a"
            ],
            [
              -5.5,
              -22.9,
              5.5,
              -18.1,
              16.7,
              "wheelhouse_roof_b"
            ],
            [
              -4,
              40.2,
              4,
              45.8,
              3.6,
              "apron_a"
            ],
            [
              -4,
              -45.8,
              4,
              -40.2,
              3.6,
              "apron_b"
            ],
            [
              -10,
              -39.8,
              10,
              39.8,
              7.2,
              "deck2"
            ],
            [
              -9.1,
              -33.8,
              9.1,
              33.8,
              10.6,
              "deck3"
            ],
            [
              -7.8,
              -25.8,
              7.8,
              25.8,
              13.6,
              "top_deck"
            ]
          ],
          "ramps": [
            [
              2,
              39.6,
              3.4,
              45.6,
              3.6,
              7.2,
              "z",
              -1
            ],
            [
              -3.4,
              39.6,
              -2,
              45.6,
              3.6,
              7.2,
              "z",
              -1
            ],
            [
              2,
              -45.6,
              3.4,
              -39.6,
              3.6,
              7.2,
              "z",
              1
            ],
            [
              -3.4,
              -45.6,
              -2,
              -39.6,
              3.6,
              7.2,
              "z",
              1
            ],
            [
              4,
              33.6,
              5.2,
              38.9,
              7.2,
              10.6,
              "z",
              -1
            ],
            [
              -5.2,
              33.6,
              -4,
              38.9,
              7.2,
              10.6,
              "z",
              -1
            ],
            [
              4,
              -38.9,
              5.2,
              -33.6,
              7.2,
              10.6,
              "z",
              1
            ],
            [
              -5.2,
              -38.9,
              -4,
              -33.6,
              7.2,
              10.6,
              "z",
              1
            ],
            [
              2.4,
              25.8,
              3.6,
              32.9,
              10.6,
              13.6,
              "z",
              -1
            ],
            [
              2.4,
              -32.9,
              3.6,
              -25.8,
              10.6,
              13.6,
              "z",
              1
            ]
          ],
          "edges": [
            [
              -5.6,
              18.1,
              -5.5,
              22.9,
              16.7,
              17.7
            ],
            [
              5.5,
              18.1,
              5.6,
              22.9,
              16.7,
              17.7
            ],
            [
              -5.6,
              -22.9,
              -5.5,
              -18.1,
              16.7,
              17.7
            ],
            [
              5.5,
              -22.9,
              5.6,
              -18.1,
              16.7,
              17.7
            ],
            [
              -5.5,
              17.4,
              5.5,
              17.5,
              16.7,
              17.7
            ],
            [
              -5.5,
              23.5,
              5.5,
              23.6,
              16.7,
              17.7
            ],
            [
              -5.6,
              17.5,
              -5.5,
              23.5,
              16.7,
              17.7
            ],
            [
              5.5,
              17.5,
              5.6,
              23.5,
              16.7,
              17.7
            ],
            [
              -5.5,
              -23.6,
              5.5,
              -23.5,
              16.7,
              17.7
            ],
            [
              -5.5,
              -17.5,
              5.5,
              -17.4,
              16.7,
              17.7
            ],
            [
              -5.6,
              -23.5,
              -5.5,
              -17.5,
              16.7,
              17.7
            ],
            [
              5.5,
              -23.5,
              5.6,
              -17.5,
              16.7,
              17.7
            ],
            [
              -10.6,
              -46.1,
              -4,
              -46,
              3.6,
              4.6
            ],
            [
              4,
              -46.1,
              10.6,
              -46,
              3.6,
              4.6
            ],
            [
              -10.6,
              46,
              -4,
              46.1,
              3.6,
              4.6
            ],
            [
              4,
              46,
              10.6,
              46.1,
              3.6,
              4.6
            ],
            [
              -10.7,
              -46,
              -10.6,
              46,
              3.6,
              4.6
            ],
            [
              10.6,
              -46,
              10.7,
              46,
              3.6,
              4.6
            ],
            [
              -10.2,
              -40.1,
              -3.4,
              -40,
              7.2,
              8.2
            ],
            [
              -1.8,
              -40.1,
              2,
              -40,
              7.2,
              8.2
            ],
            [
              3.6,
              -40.1,
              10.2,
              -40,
              7.2,
              8.2
            ],
            [
              -10.2,
              40,
              -3.4,
              40.1,
              7.2,
              8.2
            ],
            [
              -1.8,
              40,
              2,
              40.1,
              7.2,
              8.2
            ],
            [
              3.6,
              40,
              10.2,
              40.1,
              7.2,
              8.2
            ],
            [
              -10.3,
              -40,
              -10.2,
              40,
              7.2,
              8.2
            ],
            [
              10.2,
              -40,
              10.3,
              40,
              7.2,
              8.2
            ],
            [
              -9.3,
              -34.1,
              -5.1,
              -34,
              10.6,
              11.6
            ],
            [
              -3.9,
              -34.1,
              4.1,
              -34,
              10.6,
              11.6
            ],
            [
              5.3,
              -34.1,
              9.3,
              -34,
              10.6,
              11.6
            ],
            [
              -9.3,
              34,
              -5.1,
              34.1,
              10.6,
              11.6
            ],
            [
              -3.9,
              34,
              4.1,
              34.1,
              10.6,
              11.6
            ],
            [
              5.3,
              34,
              9.3,
              34.1,
              10.6,
              11.6
            ],
            [
              -9.4,
              -34,
              -9.3,
              34,
              10.6,
              11.6
            ],
            [
              9.3,
              -34,
              9.4,
              34,
              10.6,
              11.6
            ],
            [
              -8,
              -26.1,
              2.4,
              -26,
              13.6,
              14.6
            ],
            [
              3.8,
              -26.1,
              8,
              -26,
              13.6,
              14.6
            ],
            [
              -8,
              26,
              2.4,
              26.1,
              13.6,
              14.6
            ],
            [
              3.8,
              26,
              8,
              26.1,
              13.6,
              14.6
            ],
            [
              -8.1,
              -26,
              -8,
              26,
              13.6,
              14.6
            ],
            [
              8,
              -26,
              8.1,
              26,
              13.6,
              14.6
            ]
          ],
          "gaps": [
            [
              -4,
              46,
              4,
              48
            ],
            [
              -4,
              -48,
              4,
              -46
            ]
          ],
          "empties": {
            "bow_a": [
              0,
              3.6,
              47
            ],
            "bow_b": [
              0,
              3.6,
              -47
            ],
            "horn": [
              0,
              21.5,
              0
            ],
            "light_mast_a": [
              0,
              23.1,
              20
            ],
            "light_mast_b": [
              0,
              23.1,
              -20
            ],
            "stack": [
              0,
              21,
              -1.2
            ]
          },
          "meshes": [
            "body"
          ],
          "levels": {
            "main": 3.6,
            "deck2": 7.2,
            "deck3": 10.6,
            "top": 13.6
          }
        },
        "ferry_catamaran": {
          "kind": "ship",
          "length": 26.5,
          "beam": 8.5,
          "draft": 1.45,
          "freeboard": 2,
          "deckY": 2,
          "top": 9.32,
          "bbox": [
            [
              -4.25,
              -1.45,
              -13.3
            ],
            [
              4.25,
              9.32,
              13.2
            ]
          ],
          "boxes": [
            [
              3.7,
              4.8,
              -8.35,
              3.8,
              5.85,
              -8.29,
              2,
              "rail"
            ],
            [
              3.8,
              4.8,
              -8.3,
              3.88,
              5.85,
              -8.1,
              2,
              "rail"
            ],
            [
              3.85,
              4.8,
              -8.1,
              3.91,
              5.85,
              5.6,
              2,
              "rail"
            ],
            [
              3.55,
              4.8,
              5.59,
              3.88,
              5.85,
              6.4,
              2,
              "rail"
            ],
            [
              3.21,
              4.8,
              6.4,
              3.55,
              5.85,
              7.21,
              2,
              "rail"
            ],
            [
              2.4,
              4.8,
              7.21,
              3.21,
              5.85,
              7.55,
              2,
              "rail"
            ],
            [
              1.58,
              4.8,
              7.55,
              2.4,
              5.85,
              7.88,
              2,
              "rail"
            ],
            [
              -1.58,
              4.8,
              7.85,
              1.58,
              5.85,
              7.91,
              2,
              "rail"
            ],
            [
              -2.4,
              4.8,
              7.55,
              -1.58,
              5.85,
              7.88,
              2,
              "rail"
            ],
            [
              -3.21,
              4.8,
              7.21,
              -2.4,
              5.85,
              7.55,
              2,
              "rail"
            ],
            [
              -3.55,
              4.8,
              6.4,
              -3.21,
              5.85,
              7.21,
              2,
              "rail"
            ],
            [
              -3.88,
              4.8,
              5.59,
              -3.55,
              5.85,
              6.4,
              2,
              "rail"
            ],
            [
              -3.91,
              4.8,
              -8.1,
              -3.85,
              5.85,
              5.6,
              2,
              "rail"
            ],
            [
              -3.88,
              4.8,
              -8.3,
              -3.8,
              5.85,
              -8.1,
              2,
              "rail"
            ],
            [
              -3.8,
              4.8,
              -8.38,
              -3.6,
              5.85,
              -8.3,
              2,
              "rail"
            ],
            [
              -3.6,
              4.8,
              -8.41,
              2.5,
              5.85,
              -8.35,
              2,
              "rail"
            ],
            [
              3.83,
              2,
              8.6,
              4.15,
              3.05,
              9.37,
              2,
              "rail"
            ],
            [
              3.51,
              2,
              9.37,
              3.83,
              3.05,
              10.14,
              2,
              "rail"
            ],
            [
              3.19,
              2,
              10.14,
              3.51,
              3.05,
              10.91,
              2,
              "rail"
            ],
            [
              2.87,
              2,
              10.91,
              3.19,
              3.05,
              11.68,
              2,
              "rail"
            ],
            [
              2.55,
              2,
              11.68,
              2.87,
              3.05,
              12.45,
              2,
              "rail"
            ],
            [
              -2.55,
              2,
              12.42,
              2.55,
              3.05,
              12.48,
              2,
              "rail"
            ],
            [
              -2.87,
              2,
              11.68,
              -2.55,
              3.05,
              12.45,
              2,
              "rail"
            ],
            [
              -3.19,
              2,
              10.91,
              -2.87,
              3.05,
              11.68,
              2,
              "rail"
            ],
            [
              -3.51,
              2,
              10.14,
              -3.19,
              3.05,
              10.91,
              2,
              "rail"
            ],
            [
              -3.83,
              2,
              9.37,
              -3.51,
              3.05,
              10.14,
              2,
              "rail"
            ],
            [
              -4.15,
              2,
              8.6,
              -3.83,
              3.05,
              9.37,
              2,
              "rail"
            ],
            [
              4.12,
              2,
              -12.5,
              4.18,
              3.05,
              -8.6,
              2,
              "rail"
            ],
            [
              -4.15,
              2,
              -12.53,
              4.15,
              3.05,
              -12.47,
              2,
              "rail"
            ],
            [
              -4.18,
              2,
              -12.5,
              -4.12,
              3.05,
              -8.6,
              2,
              "rail"
            ],
            [
              -3.5,
              4.8,
              -6.78,
              -1.7,
              5.75,
              -6.27,
              0,
              "bench"
            ],
            [
              -0.9,
              4.8,
              -6.78,
              0.9,
              5.75,
              -6.27,
              0,
              "bench"
            ],
            [
              1.7,
              4.8,
              -6.78,
              3.5,
              5.75,
              -6.27,
              0,
              "bench"
            ],
            [
              -3.5,
              4.8,
              -4.68,
              -1.7,
              5.75,
              -4.17,
              0,
              "bench"
            ],
            [
              -0.9,
              4.8,
              -4.68,
              0.9,
              5.75,
              -4.17,
              0,
              "bench"
            ],
            [
              1.7,
              4.8,
              -4.68,
              3.5,
              5.75,
              -4.17,
              0,
              "bench"
            ],
            [
              -3.5,
              4.8,
              -2.58,
              -1.7,
              5.75,
              -2.08,
              0,
              "bench"
            ],
            [
              -0.9,
              4.8,
              -2.58,
              0.9,
              5.75,
              -2.08,
              0,
              "bench"
            ],
            [
              1.7,
              4.8,
              -2.58,
              3.5,
              5.75,
              -2.08,
              0,
              "bench"
            ],
            [
              -3.5,
              4.8,
              -0.48,
              -1.7,
              5.75,
              0.02,
              0,
              "bench"
            ],
            [
              -0.9,
              4.8,
              -0.48,
              0.9,
              5.75,
              0.02,
              0,
              "bench"
            ],
            [
              1.7,
              4.8,
              -0.48,
              3.5,
              5.75,
              0.02,
              0,
              "bench"
            ],
            [
              -3.5,
              4.8,
              1.62,
              -1.7,
              5.75,
              2.13,
              0,
              "bench"
            ],
            [
              -0.9,
              4.8,
              1.62,
              0.9,
              5.75,
              2.13,
              0,
              "bench"
            ],
            [
              1.7,
              4.8,
              1.62,
              3.5,
              5.75,
              2.13,
              0,
              "bench"
            ],
            [
              2.6,
              3.5,
              -11.63,
              3.6,
              4.45,
              -11.57,
              2,
              "rail"
            ],
            [
              3.57,
              3.5,
              -11.6,
              3.63,
              4.45,
              -10.66,
              2,
              "rail"
            ],
            [
              2.6,
              2,
              -11.6,
              3.6,
              3.5,
              -10.6,
              4,
              "deck_landing"
            ],
            [
              -4.25,
              -1.45,
              -12.6,
              4.25,
              2,
              12.6,
              4,
              "deck_main"
            ],
            [
              -4,
              2,
              -8.5,
              4,
              4.8,
              8,
              4,
              "cabin"
            ],
            [
              -2.2,
              4.8,
              4.6,
              2.2,
              7,
              7.6,
              4,
              "wheelhouse"
            ]
          ],
          "decks": [
            [
              2.6,
              -11.6,
              3.6,
              -10.6,
              3.5,
              "stair_landing"
            ],
            [
              -2.5,
              8.1,
              2.5,
              12.4,
              2,
              "bow_deck"
            ],
            [
              -4.1,
              -12.4,
              4.1,
              -8.6,
              2,
              "stern_deck"
            ],
            [
              -3.85,
              -8.3,
              3.85,
              4.5,
              4.8,
              "upper_deck"
            ]
          ],
          "ramps": [
            [
              0.1,
              -11.6,
              2.6,
              -10.6,
              2,
              3.5,
              "x",
              1
            ],
            [
              2.6,
              -10.6,
              3.6,
              -8.5,
              3.5,
              4.8,
              "z",
              1
            ]
          ],
          "edges": [
            [
              3.6,
              -10.6,
              3.7,
              -10.6,
              3.5,
              4.5
            ],
            [
              4.25,
              -12.7,
              4.25,
              -12.6,
              2,
              3
            ],
            [
              -4.25,
              12.6,
              -2.45,
              12.7,
              2,
              3
            ],
            [
              2.75,
              12.6,
              4.25,
              12.7,
              2,
              3
            ],
            [
              -4.35,
              -8.4,
              -4.25,
              8.6,
              2,
              3
            ],
            [
              -4.35,
              9.4,
              -4.25,
              12.6,
              2,
              3
            ],
            [
              4.25,
              -12.6,
              4.35,
              -12.4,
              2,
              3
            ],
            [
              4.25,
              -8.4,
              4.35,
              8.6,
              2,
              3
            ],
            [
              4.25,
              9.4,
              4.35,
              12.6,
              2,
              3
            ],
            [
              -4,
              -8.6,
              -3.6,
              -8.5,
              4.8,
              5.8
            ],
            [
              3.8,
              -8.6,
              4,
              -8.5,
              4.8,
              5.8
            ],
            [
              -4,
              8,
              -1.6,
              8.1,
              4.8,
              5.8
            ],
            [
              1.6,
              8,
              4,
              8.1,
              4.8,
              5.8
            ],
            [
              -4.1,
              -8.5,
              -4,
              -8.1,
              4.8,
              5.8
            ],
            [
              -4.1,
              5.7,
              -4,
              8,
              4.8,
              5.8
            ],
            [
              4,
              -8.5,
              4.1,
              -8.1,
              4.8,
              5.8
            ],
            [
              4,
              5.7,
              4.1,
              8,
              4.8,
              5.8
            ],
            [
              -2.2,
              4.5,
              2.2,
              4.6,
              7,
              8
            ],
            [
              -2.2,
              7.6,
              2.2,
              7.7,
              7,
              8
            ],
            [
              -2.3,
              4.6,
              -2.2,
              7.6,
              7,
              8
            ],
            [
              2.2,
              4.6,
              2.3,
              7.6,
              7,
              8
            ]
          ],
          "gaps": [
            [
              -2.6,
              12.2,
              2.6,
              13.4
            ],
            [
              -4.4,
              -12.9,
              -2,
              -12.2
            ]
          ],
          "empties": {
            "bow": [
              0,
              2,
              12.6
            ],
            "exhaust_l": [
              3.1,
              0.6,
              -12.8
            ],
            "exhaust_r": [
              -3.1,
              0.6,
              -12.8
            ],
            "horn": [
              0,
              7.4,
              6.4
            ],
            "light_mast": [
              0,
              9.25,
              5.6
            ]
          },
          "meshes": [
            "body"
          ],
          "levels": {
            "main": 2,
            "upper": 4.8
          }
        },
        "sightseeing_boat": {
          "kind": "ship",
          "length": 46,
          "beam": 9.9,
          "draft": 2.2,
          "freeboard": 2.4,
          "deckY": 2.2,
          "top": 12.78,
          "bbox": [
            [
              -4.91,
              -2.2,
              -22.62
            ],
            [
              4.91,
              12.78,
              23.5
            ]
          ],
          "boxes": [
            [
              3.8,
              4.9,
              -16.63,
              3.96,
              5.95,
              -16.56,
              2,
              "rail"
            ],
            [
              3.96,
              4.9,
              -16.56,
              4.28,
              5.95,
              -15.8,
              2,
              "rail"
            ],
            [
              4.25,
              4.9,
              -15.8,
              4.31,
              5.95,
              10.5,
              2,
              "rail"
            ],
            [
              3.95,
              4.9,
              10.5,
              4.28,
              5.95,
              11.29,
              2,
              "rail"
            ],
            [
              3.62,
              4.9,
              11.29,
              3.95,
              5.95,
              12.09,
              2,
              "rail"
            ],
            [
              3.29,
              4.9,
              12.09,
              3.62,
              5.95,
              12.89,
              2,
              "rail"
            ],
            [
              2.48,
              4.9,
              12.89,
              3.29,
              5.95,
              13.22,
              2,
              "rail"
            ],
            [
              1.68,
              4.9,
              13.22,
              2.48,
              5.95,
              13.55,
              2,
              "rail"
            ],
            [
              0.87,
              4.9,
              13.55,
              1.68,
              5.95,
              13.88,
              2,
              "rail"
            ],
            [
              -0.87,
              4.9,
              13.85,
              0.87,
              5.95,
              13.91,
              2,
              "rail"
            ],
            [
              -1.68,
              4.9,
              13.55,
              -0.87,
              5.95,
              13.88,
              2,
              "rail"
            ],
            [
              -2.48,
              4.9,
              13.22,
              -1.68,
              5.95,
              13.55,
              2,
              "rail"
            ],
            [
              -3.29,
              4.9,
              12.89,
              -2.48,
              5.95,
              13.22,
              2,
              "rail"
            ],
            [
              -3.62,
              4.9,
              12.09,
              -3.29,
              5.95,
              12.89,
              2,
              "rail"
            ],
            [
              -3.95,
              4.9,
              11.29,
              -3.62,
              5.95,
              12.09,
              2,
              "rail"
            ],
            [
              -4.28,
              4.9,
              10.5,
              -3.95,
              5.95,
              11.29,
              2,
              "rail"
            ],
            [
              -4.31,
              4.9,
              -15.8,
              -4.25,
              5.95,
              10.5,
              2,
              "rail"
            ],
            [
              -4.28,
              4.9,
              -16.56,
              -3.96,
              5.95,
              -15.8,
              2,
              "rail"
            ],
            [
              -3.96,
              4.9,
              -16.88,
              -3.19,
              5.95,
              -16.56,
              2,
              "rail"
            ],
            [
              -3.19,
              4.9,
              -16.91,
              2.5,
              5.95,
              -16.85,
              2,
              "rail"
            ],
            [
              -2.4,
              7.5,
              -11.91,
              3.2,
              8.55,
              -11.85,
              2,
              "rail"
            ],
            [
              3.2,
              7.5,
              -11.88,
              3.68,
              8.55,
              -11.68,
              2,
              "rail"
            ],
            [
              3.68,
              7.5,
              -11.68,
              3.88,
              8.55,
              -11.2,
              2,
              "rail"
            ],
            [
              3.85,
              7.5,
              -11.2,
              3.91,
              8.55,
              6.99,
              2,
              "rail"
            ],
            [
              3.6,
              7.5,
              6.99,
              3.88,
              8.55,
              7.68,
              2,
              "rail"
            ],
            [
              3.32,
              7.5,
              7.68,
              3.6,
              8.55,
              8.36,
              2,
              "rail"
            ],
            [
              3.04,
              7.5,
              8.36,
              3.32,
              8.55,
              9.04,
              2,
              "rail"
            ],
            [
              2.35,
              7.5,
              9.04,
              3.04,
              8.55,
              9.32,
              2,
              "rail"
            ],
            [
              1.66,
              7.5,
              9.32,
              2.35,
              8.55,
              9.6,
              2,
              "rail"
            ],
            [
              0.98,
              7.5,
              9.6,
              1.66,
              8.55,
              9.88,
              2,
              "rail"
            ],
            [
              -0.97,
              7.5,
              9.85,
              0.98,
              8.55,
              9.91,
              2,
              "rail"
            ],
            [
              -1.66,
              7.5,
              9.6,
              -0.98,
              8.55,
              9.88,
              2,
              "rail"
            ],
            [
              -2.35,
              7.5,
              9.32,
              -1.66,
              8.55,
              9.6,
              2,
              "rail"
            ],
            [
              -3.04,
              7.5,
              9.04,
              -2.35,
              8.55,
              9.32,
              2,
              "rail"
            ],
            [
              -3.32,
              7.5,
              8.36,
              -3.04,
              8.55,
              9.04,
              2,
              "rail"
            ],
            [
              -3.6,
              7.5,
              7.68,
              -3.32,
              8.55,
              8.36,
              2,
              "rail"
            ],
            [
              -3.88,
              7.5,
              6.99,
              -3.6,
              8.55,
              7.68,
              2,
              "rail"
            ],
            [
              -3.91,
              7.5,
              -11.2,
              -3.85,
              8.55,
              6.99,
              2,
              "rail"
            ],
            [
              -3.88,
              7.5,
              -11.63,
              -3.7,
              8.55,
              -11.2,
              2,
              "rail"
            ],
            [
              -3.45,
              7.5,
              -10.28,
              -1.55,
              8.45,
              -9.77,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              -10.28,
              0.95,
              8.45,
              -9.77,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              -10.28,
              3.45,
              8.45,
              -9.77,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              -7.88,
              -1.55,
              8.45,
              -7.37,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              -7.88,
              0.95,
              8.45,
              -7.37,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              -7.88,
              3.45,
              8.45,
              -7.37,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              -5.48,
              -1.55,
              8.45,
              -4.98,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              -5.48,
              0.95,
              8.45,
              -4.98,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              -5.48,
              3.45,
              8.45,
              -4.98,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              -3.08,
              -1.55,
              8.45,
              -2.57,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              -3.08,
              0.95,
              8.45,
              -2.57,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              -3.08,
              3.45,
              8.45,
              -2.57,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              -0.68,
              -1.55,
              8.45,
              -0.17,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              -0.68,
              0.95,
              8.45,
              -0.17,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              -0.68,
              3.45,
              8.45,
              -0.17,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              1.72,
              -1.55,
              8.45,
              2.23,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              1.72,
              0.95,
              8.45,
              2.23,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              1.72,
              3.45,
              8.45,
              2.23,
              0,
              "bench"
            ],
            [
              -3.45,
              7.5,
              4.12,
              -1.55,
              8.45,
              4.63,
              0,
              "bench"
            ],
            [
              -0.95,
              7.5,
              4.12,
              0.95,
              8.45,
              4.63,
              0,
              "bench"
            ],
            [
              1.55,
              7.5,
              4.12,
              3.45,
              8.45,
              4.63,
              0,
              "bench"
            ],
            [
              1.5,
              2.2,
              16.3,
              1.9,
              2.8,
              16.7,
              0,
              "bollard"
            ],
            [
              3.2,
              2.2,
              -22.35,
              3.6,
              2.8,
              -21.95,
              0,
              "bollard"
            ],
            [
              -1.9,
              2.2,
              16.3,
              -1.5,
              2.8,
              16.7,
              0,
              "bollard"
            ],
            [
              -3.6,
              2.2,
              -22.35,
              -3.2,
              2.8,
              -21.95,
              0,
              "bollard"
            ],
            [
              -4.8,
              -2.2,
              -22.5,
              4.8,
              2.2,
              22,
              4,
              "deck_main"
            ],
            [
              -4.4,
              2.2,
              -17,
              4.4,
              4.9,
              14,
              4,
              "deck2_house"
            ],
            [
              -4,
              4.9,
              -12,
              4,
              7.5,
              10,
              4,
              "top_house"
            ],
            [
              -2.4,
              7.5,
              6.4,
              2.4,
              9.9,
              9.8,
              4,
              "wheelhouse"
            ]
          ],
          "decks": [
            [
              -3.85,
              -22.3,
              3.85,
              -17.2,
              2.2,
              "stern_deck"
            ],
            [
              -2.79,
              14.2,
              2.79,
              16,
              2.2,
              "bow_deck"
            ],
            [
              -2.34,
              16,
              2.34,
              18,
              2.2,
              "bow_deck_2"
            ],
            [
              -1.79,
              18,
              1.79,
              20,
              2.2,
              "bow_deck_3"
            ],
            [
              -1.26,
              20,
              1.26,
              21.5,
              2.2,
              "bow_deck_4"
            ],
            [
              -4.3,
              -16.8,
              4.3,
              13.8,
              4.9,
              "deck2"
            ],
            [
              -3.9,
              -11.8,
              3.9,
              6.2,
              7.5,
              "top_deck"
            ]
          ],
          "ramps": [
            [
              2.6,
              -21,
              3.7,
              -16.4,
              2.2,
              4.9,
              "z",
              1
            ],
            [
              -3.6,
              -15.7,
              -2.5,
              -11.4,
              4.9,
              7.5,
              "z",
              1
            ]
          ],
          "edges": [
            [
              -4.4,
              -16.8,
              -4.3,
              -16.4,
              4.9,
              5.9
            ],
            [
              -4.4,
              11.4,
              -4.3,
              13.8,
              4.9,
              5.9
            ],
            [
              4.3,
              -16.8,
              4.4,
              -16.4,
              4.9,
              5.9
            ],
            [
              4.3,
              11.4,
              4.4,
              13.8,
              4.9,
              5.9
            ],
            [
              -4,
              -11.8,
              -3.9,
              -11.6,
              7.5,
              8.5
            ],
            [
              3.9,
              -11.8,
              4,
              -11.6,
              7.5,
              8.5
            ],
            [
              -4.8,
              -22.6,
              -2.4,
              -22.5,
              2.2,
              3.2
            ],
            [
              2.6,
              -22.6,
              4.8,
              -22.5,
              2.2,
              3.2
            ],
            [
              -4.8,
              22,
              4.8,
              22.1,
              2.2,
              3.2
            ],
            [
              -4.9,
              -22.5,
              -4.8,
              22,
              2.2,
              3.2
            ],
            [
              4.8,
              -22.5,
              4.9,
              22,
              2.2,
              3.2
            ],
            [
              -4.4,
              -17.1,
              -3.2,
              -17,
              4.9,
              5.9
            ],
            [
              3.8,
              -17.1,
              4.4,
              -17,
              4.9,
              5.9
            ],
            [
              -4.4,
              14,
              -0.8,
              14.1,
              4.9,
              5.9
            ],
            [
              1,
              14,
              4.4,
              14.1,
              4.9,
              5.9
            ],
            [
              -4.5,
              -17,
              -4.4,
              -15.8,
              4.9,
              5.9
            ],
            [
              -4.5,
              10.6,
              -4.4,
              14,
              4.9,
              5.9
            ],
            [
              4.4,
              -17,
              4.5,
              -15.8,
              4.9,
              5.9
            ],
            [
              4.4,
              10.6,
              4.5,
              14,
              4.9,
              5.9
            ],
            [
              -4,
              -12.1,
              -3.6,
              -12,
              7.5,
              8.5
            ],
            [
              3.4,
              -12.1,
              4,
              -12,
              7.5,
              8.5
            ],
            [
              -4,
              10,
              -0.8,
              10.1,
              7.5,
              8.5
            ],
            [
              1.2,
              10,
              4,
              10.1,
              7.5,
              8.5
            ],
            [
              -4.1,
              -12,
              -4,
              -11.2,
              7.5,
              8.5
            ],
            [
              -4.1,
              7.2,
              -4,
              10,
              7.5,
              8.5
            ],
            [
              4,
              -12,
              4.1,
              -11.2,
              7.5,
              8.5
            ],
            [
              4,
              7.2,
              4.1,
              10,
              7.5,
              8.5
            ],
            [
              -2.4,
              6.3,
              2.4,
              6.4,
              9.9,
              10.9
            ],
            [
              -2.4,
              9.8,
              2.4,
              9.9,
              9.9,
              10.9
            ],
            [
              -2.5,
              6.4,
              -2.4,
              9.8,
              9.9,
              10.9
            ],
            [
              2.4,
              6.4,
              2.5,
              9.8,
              9.9,
              10.9
            ]
          ],
          "gaps": [
            [
              -2.5,
              -23.5,
              2.5,
              -22
            ]
          ],
          "empties": {
            "horn": [
              0,
              10.6,
              7.4
            ],
            "light_mast": [
              0,
              12.7,
              7.4
            ],
            "stack": [
              0,
              9.9,
              6.6
            ]
          },
          "meshes": [
            "body"
          ],
          "levels": {
            "main": 2.2,
            "deck2": 4.9,
            "top": 7.5
          }
        },
        "sailboat": {
          "kind": "ship",
          "length": 12.2,
          "beam": 3.9,
          "draft": 2.18,
          "freeboard": 1.05,
          "deckY": 1.12,
          "top": 17.26,
          "bbox": [
            [
              -2.03,
              -2.18,
              -6
            ],
            [
              2.03,
              17.26,
              6.23
            ]
          ],
          "boxes": [
            [
              -1.95,
              -0.55,
              -6,
              1.95,
              1.1,
              6,
              4,
              "deck"
            ],
            [
              -1.15,
              1.14,
              -1.5,
              1.15,
              1.69,
              2.5,
              4,
              "coachroof"
            ],
            [
              -0.12,
              -1.95,
              -0.8,
              0.12,
              -0.45,
              0.8,
              4,
              "keel"
            ],
            [
              -0.12,
              1.69,
              1.58,
              0.12,
              17.2,
              1.82,
              0,
              "mast"
            ],
            [
              1.15,
              1.07,
              -4.9,
              1.25,
              1.42,
              -1.5,
              4,
              "coaming"
            ],
            [
              0.75,
              1.07,
              -4.6,
              1.15,
              1.37,
              -1.6,
              0,
              "seat"
            ],
            [
              -1.25,
              1.07,
              -4.9,
              -1.15,
              1.42,
              -1.5,
              4,
              "coaming"
            ],
            [
              -1.15,
              1.07,
              -4.6,
              -0.75,
              1.37,
              -1.6,
              0,
              "seat"
            ],
            [
              -1.25,
              1.07,
              -1.6,
              1.25,
              1.42,
              -1.5,
              4,
              "coaming"
            ],
            [
              -0.55,
              1.07,
              -4.35,
              0.55,
              2.44,
              -4,
              0,
              "helm"
            ],
            [
              -0.22,
              2.47,
              0.68,
              0,
              2.63,
              1.61,
              0,
              "boom"
            ],
            [
              -0.43,
              2.47,
              -0.26,
              -0.22,
              2.63,
              0.68,
              0,
              "boom"
            ],
            [
              -0.65,
              2.47,
              -1.19,
              -0.43,
              2.63,
              -0.26,
              0,
              "boom"
            ],
            [
              -0.87,
              2.47,
              -2.13,
              -0.65,
              2.63,
              -1.19,
              0,
              "boom"
            ],
            [
              -1.08,
              2.47,
              -3.06,
              -0.87,
              2.63,
              -2.13,
              0,
              "boom"
            ],
            [
              -1.3,
              2.47,
              -4,
              -1.08,
              2.63,
              -3.06,
              0,
              "boom"
            ]
          ],
          "decks": [
            [
              -1.6,
              -5.4,
              1.6,
              0,
              1.07,
              "deck"
            ]
          ],
          "ramps": [
            [
              -1.5,
              0,
              1.5,
              2.5,
              1.12,
              1.2,
              "z",
              1
            ],
            [
              -1,
              2.5,
              1,
              4.6,
              1.2,
              1.28,
              "z",
              1
            ]
          ],
          "edges": [
            [
              -1.95,
              6,
              1.95,
              6.1,
              1.1,
              2.1
            ],
            [
              -2.05,
              -5.2,
              -1.95,
              6,
              1.1,
              2.1
            ],
            [
              1.95,
              -5.2,
              2.05,
              6,
              1.1,
              2.1
            ],
            [
              -0.95,
              -1.6,
              -0.75,
              -1.5,
              1.69,
              2.69
            ],
            [
              -0.55,
              -1.6,
              1.15,
              -1.5,
              1.69,
              2.69
            ],
            [
              -1.15,
              2.5,
              -0.95,
              2.6,
              1.69,
              2.69
            ],
            [
              1.05,
              2.5,
              1.15,
              2.6,
              1.69,
              2.69
            ],
            [
              -1.25,
              -1.5,
              -1.15,
              2.3,
              1.69,
              2.69
            ],
            [
              1.15,
              -1.5,
              1.25,
              2.3,
              1.69,
              2.69
            ]
          ],
          "gaps": [
            [
              -2,
              -7,
              2,
              -5.4
            ]
          ],
          "empties": {
            "helm": [
              0,
              1.92,
              -4.6
            ],
            "light_mast": [
              0,
              17.25,
              1.7
            ],
            "mast_top": [
              0,
              17.2,
              1.7
            ],
            "wake_origin": [
              0,
              0,
              -6
            ]
          },
          "meshes": [
            "body"
          ]
        },
        "barge": {
          "kind": "ship",
          "length": 60,
          "beam": 11.6,
          "draft": 2.6,
          "freeboard": 1,
          "deckY": 1,
          "top": 4.01,
          "bbox": [
            [
              -5.96,
              -2.6,
              -30
            ],
            [
              5.96,
              4.01,
              30
            ]
          ],
          "boxes": [
            [
              5.04,
              1,
              -29.01,
              5.36,
              1.55,
              -27.99,
              0,
              "bitt"
            ],
            [
              5.04,
              1,
              -10.51,
              5.36,
              1.55,
              -9.49,
              0,
              "bitt"
            ],
            [
              5.04,
              1,
              9.49,
              5.36,
              1.55,
              10.51,
              0,
              "bitt"
            ],
            [
              5.04,
              1,
              27.99,
              5.36,
              1.55,
              29.01,
              0,
              "bitt"
            ],
            [
              -5.36,
              1,
              -29.01,
              -5.04,
              1.55,
              -27.99,
              0,
              "bitt"
            ],
            [
              -5.36,
              1,
              -10.51,
              -5.04,
              1.55,
              -9.49,
              0,
              "bitt"
            ],
            [
              -5.36,
              1,
              9.49,
              -5.04,
              1.55,
              10.51,
              0,
              "bitt"
            ],
            [
              -5.36,
              1,
              27.99,
              -5.04,
              1.55,
              29.01,
              0,
              "bitt"
            ],
            [
              -5.8,
              -2.6,
              -30,
              5.8,
              1,
              30,
              4,
              "deck"
            ],
            [
              -4.8,
              1,
              -26,
              4.8,
              2.2,
              -25.7,
              4,
              "coaming"
            ],
            [
              -4.8,
              1,
              25.7,
              4.8,
              2.2,
              26,
              4,
              "coaming"
            ],
            [
              -4.8,
              1,
              -26,
              -4.5,
              2.2,
              26,
              4,
              "coaming"
            ],
            [
              4.5,
              1,
              -26,
              4.8,
              2.2,
              26,
              4,
              "coaming"
            ],
            [
              -4.5,
              1,
              -25.7,
              4.5,
              2.3,
              25.7,
              4,
              "cargo"
            ]
          ],
          "decks": [
            [
              -5.6,
              26.1,
              5.6,
              29.6,
              1,
              "deck_rim_a"
            ],
            [
              -5.6,
              -29.6,
              5.6,
              -26.1,
              1,
              "deck_rim_b"
            ]
          ],
          "ramps": [],
          "edges": [
            [
              -5.8,
              -30.1,
              5.8,
              -30,
              1,
              2
            ],
            [
              -5.8,
              30,
              5.8,
              30.1,
              1,
              2
            ],
            [
              -5.9,
              -30,
              -5.8,
              30,
              1,
              2
            ],
            [
              5.8,
              -30,
              5.9,
              30,
              1,
              2
            ],
            [
              -4.8,
              -26.1,
              4.8,
              -26,
              2.2,
              3.2
            ],
            [
              -4.9,
              -26,
              -4.8,
              -25.7,
              2.2,
              3.2
            ],
            [
              4.8,
              -26,
              4.9,
              -25.7,
              2.2,
              3.2
            ],
            [
              -4.8,
              26,
              4.8,
              26.1,
              2.2,
              3.2
            ],
            [
              -4.9,
              25.7,
              -4.8,
              26,
              2.2,
              3.2
            ],
            [
              4.8,
              25.7,
              4.9,
              26,
              2.2,
              3.2
            ],
            [
              -4.8,
              -26.1,
              -4.5,
              -26,
              2.2,
              3.2
            ],
            [
              -4.8,
              26,
              -4.5,
              26.1,
              2.2,
              3.2
            ],
            [
              -4.9,
              -26,
              -4.8,
              26,
              2.2,
              3.2
            ],
            [
              4.5,
              -26.1,
              4.8,
              -26,
              2.2,
              3.2
            ],
            [
              4.5,
              26,
              4.8,
              26.1,
              2.2,
              3.2
            ],
            [
              4.8,
              -26,
              4.9,
              26,
              2.2,
              3.2
            ]
          ],
          "gaps": [],
          "empties": {
            "push_a": [
              0,
              1,
              30
            ],
            "push_b": [
              0,
              1,
              -30
            ]
          },
          "meshes": [
            "body"
          ]
        },
        "tugboat_push": {
          "kind": "ship",
          "length": 20.25,
          "beam": 8.1,
          "draft": 2.4,
          "freeboard": 1.9,
          "deckY": 1.9,
          "top": 15.18,
          "bbox": [
            [
              -4.41,
              -2.4,
              -9.55
            ],
            [
              4.41,
              15.18,
              10.75
            ]
          ],
          "boxes": [
            [
              2.17,
              1.9,
              7.05,
              2.43,
              4.7,
              9.6,
              0,
              "knee_brace"
            ],
            [
              -2.43,
              1.9,
              7.05,
              -2.17,
              4.7,
              9.6,
              0,
              "knee_brace"
            ],
            [
              0.4,
              2.05,
              7.8,
              1.5,
              3.2,
              8.6,
              0,
              "winch"
            ],
            [
              -1.5,
              2.05,
              7.8,
              -0.4,
              3.2,
              8.6,
              0,
              "winch"
            ],
            [
              2.19,
              4.6,
              -6.1,
              2.7,
              5.6,
              -5.9,
              2,
              "rail"
            ],
            [
              2.7,
              4.6,
              -5.89,
              2.9,
              5.6,
              -5.4,
              2,
              "rail"
            ],
            [
              2.87,
              4.6,
              -5.4,
              2.93,
              5.6,
              3.7,
              2,
              "rail"
            ],
            [
              2.7,
              4.6,
              3.7,
              2.9,
              5.6,
              4.19,
              2,
              "rail"
            ],
            [
              2.19,
              4.6,
              4.2,
              2.7,
              5.6,
              4.4,
              2,
              "rail"
            ],
            [
              -2.2,
              4.6,
              4.37,
              2.2,
              5.6,
              4.43,
              2,
              "rail"
            ],
            [
              -2.69,
              4.6,
              4.2,
              -2.19,
              5.6,
              4.4,
              2,
              "rail"
            ],
            [
              -2.9,
              4.6,
              3.7,
              -2.7,
              5.6,
              4.19,
              2,
              "rail"
            ],
            [
              -2.93,
              4.6,
              -5.4,
              -2.87,
              5.6,
              3.7,
              2,
              "rail"
            ],
            [
              -2.9,
              4.6,
              -5.89,
              -2.7,
              5.6,
              -5.4,
              2,
              "rail"
            ],
            [
              -2.69,
              4.6,
              -6.1,
              -2.19,
              5.6,
              -5.9,
              2,
              "rail"
            ],
            [
              -2.2,
              4.6,
              -6.13,
              2.2,
              5.6,
              -6.07,
              2,
              "rail"
            ],
            [
              2,
              7.2,
              -4.1,
              2.35,
              8.2,
              -3.95,
              2,
              "rail"
            ],
            [
              2.35,
              7.2,
              -3.95,
              2.5,
              8.2,
              -3.6,
              2,
              "rail"
            ],
            [
              2.47,
              7.2,
              -3.6,
              2.53,
              8.2,
              2.4,
              2,
              "rail"
            ],
            [
              2.35,
              7.2,
              2.4,
              2.5,
              8.2,
              2.75,
              2,
              "rail"
            ],
            [
              2,
              7.2,
              2.75,
              2.35,
              8.2,
              2.9,
              2,
              "rail"
            ],
            [
              -2,
              7.2,
              2.87,
              2,
              8.2,
              2.93,
              2,
              "rail"
            ],
            [
              -2.35,
              7.2,
              2.75,
              -2,
              8.2,
              2.9,
              2,
              "rail"
            ],
            [
              -2.5,
              7.2,
              2.4,
              -2.35,
              8.2,
              2.75,
              2,
              "rail"
            ],
            [
              -2.53,
              7.2,
              -3.6,
              -2.47,
              8.2,
              2.4,
              2,
              "rail"
            ],
            [
              -2.5,
              7.2,
              -3.95,
              -2.35,
              8.2,
              -3.6,
              2,
              "rail"
            ],
            [
              -2.35,
              7.2,
              -4.1,
              -2,
              8.2,
              -3.95,
              2,
              "rail"
            ],
            [
              -2,
              7.2,
              -4.13,
              2,
              8.2,
              -4.07,
              2,
              "rail"
            ],
            [
              1.21,
              4.6,
              -5.39,
              1.99,
              9.6,
              -4.61,
              0,
              "stack"
            ],
            [
              -1.99,
              4.6,
              -5.39,
              -1.21,
              9.6,
              -4.61,
              0,
              "stack"
            ],
            [
              -1.71,
              12,
              2.19,
              -1.49,
              12.41,
              2.56,
              0,
              "searchlight"
            ],
            [
              1.49,
              12,
              2.19,
              1.71,
              12.41,
              2.56,
              0,
              "searchlight"
            ],
            [
              -4,
              -2.4,
              -9.5,
              4,
              1.9,
              10.2,
              4,
              "deck"
            ],
            [
              -3,
              1.9,
              -6.2,
              3,
              4.6,
              4.5,
              4,
              "house1"
            ],
            [
              -2.6,
              4.6,
              -4.2,
              2.6,
              7.2,
              3,
              4,
              "house2"
            ],
            [
              -1.2,
              7.2,
              -0.4,
              1.2,
              9.4,
              1.8,
              4,
              "tower"
            ],
            [
              -2.6,
              9.4,
              -1.1,
              2.6,
              12,
              2.7,
              4,
              "wheelhouse"
            ],
            [
              2.05,
              -0.3,
              9.6,
              2.6,
              5.4,
              10.75,
              4,
              "push_knee"
            ],
            [
              -2.6,
              -0.3,
              9.6,
              -2.05,
              5.4,
              10.75,
              4,
              "push_knee"
            ]
          ],
          "decks": [
            [
              -3.8,
              4.7,
              3.8,
              9.5,
              2.05,
              "foredeck"
            ],
            [
              -3,
              -9.2,
              3,
              -6.4,
              1.9,
              "afterdeck"
            ],
            [
              -2.9,
              -6.1,
              2.9,
              4.4,
              4.6,
              "house1_roof"
            ],
            [
              -2.5,
              -4.1,
              2.5,
              2.9,
              7.2,
              "house2_roof"
            ],
            [
              -2.5,
              -1,
              2.5,
              2.6,
              12,
              "wheelhouse_roof"
            ]
          ],
          "ramps": [],
          "edges": [
            [
              -2.9,
              -6.2,
              -2.7,
              -6.1,
              4.6,
              5.6
            ],
            [
              2.9,
              -6.2,
              2.9,
              -6.1,
              4.6,
              5.6
            ],
            [
              -2.9,
              4.4,
              -2.7,
              4.5,
              4.6,
              5.6
            ],
            [
              2.9,
              4.4,
              2.9,
              4.5,
              4.6,
              5.6
            ],
            [
              -3,
              -6.1,
              -2.9,
              -5.9,
              4.6,
              5.6
            ],
            [
              -3,
              4.3,
              -2.9,
              4.4,
              4.6,
              5.6
            ],
            [
              2.9,
              -6.1,
              3,
              -5.9,
              4.6,
              5.6
            ],
            [
              2.9,
              4.3,
              3,
              4.4,
              4.6,
              5.6
            ],
            [
              -2.5,
              -4.2,
              -2.3,
              -4.1,
              7.2,
              8.2
            ],
            [
              2.5,
              -4.2,
              2.5,
              -4.1,
              7.2,
              8.2
            ],
            [
              -2.5,
              2.9,
              -2.3,
              3,
              7.2,
              8.2
            ],
            [
              2.5,
              2.9,
              2.5,
              3,
              7.2,
              8.2
            ],
            [
              -2.6,
              -4.1,
              -2.5,
              -3.9,
              7.2,
              8.2
            ],
            [
              -2.6,
              2.9,
              -2.5,
              2.9,
              7.2,
              8.2
            ],
            [
              2.5,
              -4.1,
              2.6,
              -3.9,
              7.2,
              8.2
            ],
            [
              2.5,
              2.9,
              2.6,
              2.9,
              7.2,
              8.2
            ],
            [
              -2.5,
              -1.1,
              2.5,
              -1,
              12,
              13
            ],
            [
              -2.5,
              2.6,
              -1.7,
              2.7,
              12,
              13
            ],
            [
              -1.3,
              2.6,
              1.5,
              2.7,
              12,
              13
            ],
            [
              1.9,
              2.6,
              2.5,
              2.7,
              12,
              13
            ],
            [
              -2.6,
              -1,
              -2.5,
              2.6,
              12,
              13
            ],
            [
              2.5,
              -1,
              2.6,
              2.6,
              12,
              13
            ],
            [
              -4,
              -9.6,
              4,
              -9.5,
              1.9,
              2.9
            ],
            [
              -4,
              10.2,
              -2.6,
              10.3,
              1.9,
              2.9
            ],
            [
              -2,
              10.2,
              2.2,
              10.3,
              1.9,
              2.9
            ],
            [
              2.8,
              10.2,
              4,
              10.3,
              1.9,
              2.9
            ],
            [
              -4.1,
              -9.5,
              -4,
              10.2,
              1.9,
              2.9
            ],
            [
              4,
              -9.5,
              4.1,
              10.2,
              1.9,
              2.9
            ],
            [
              -3,
              -6.3,
              -2.2,
              -6.2,
              4.6,
              5.6
            ],
            [
              2.4,
              -6.3,
              3,
              -6.2,
              4.6,
              5.6
            ],
            [
              -3,
              4.5,
              -2.6,
              4.6,
              4.6,
              5.6
            ],
            [
              2.8,
              4.5,
              3,
              4.6,
              4.6,
              5.6
            ],
            [
              -3.1,
              -6.2,
              -3,
              -5.8,
              4.6,
              5.6
            ],
            [
              -3.1,
              4.4,
              -3,
              4.5,
              4.6,
              5.6
            ],
            [
              3,
              -6.2,
              3.1,
              -5.8,
              4.6,
              5.6
            ],
            [
              3,
              4.4,
              3.1,
              4.5,
              4.6,
              5.6
            ],
            [
              -2.6,
              -4.3,
              -2,
              -4.2,
              7.2,
              8.2
            ],
            [
              2.2,
              -4.3,
              2.6,
              -4.2,
              7.2,
              8.2
            ],
            [
              -2.6,
              3,
              -2.2,
              3.1,
              7.2,
              8.2
            ],
            [
              2.4,
              3,
              2.6,
              3.1,
              7.2,
              8.2
            ],
            [
              -2.7,
              -4.2,
              -2.6,
              -3.8,
              7.2,
              8.2
            ],
            [
              -2.7,
              2.8,
              -2.6,
              3,
              7.2,
              8.2
            ],
            [
              2.6,
              -4.2,
              2.7,
              -3.8,
              7.2,
              8.2
            ],
            [
              2.6,
              2.8,
              2.7,
              3,
              7.2,
              8.2
            ],
            [
              -2.6,
              -1.2,
              2.6,
              -1.1,
              12,
              13
            ],
            [
              -2.6,
              2.7,
              2.6,
              2.8,
              12,
              13
            ],
            [
              -2.7,
              -1.1,
              -2.6,
              2.7,
              12,
              13
            ],
            [
              2.6,
              -1.1,
              2.7,
              2.7,
              12,
              13
            ]
          ],
          "gaps": [],
          "empties": {
            "horn": [
              0,
              14.6,
              0.8
            ],
            "light_mast": [
              0,
              15.1,
              0.8
            ],
            "push_face": [
              0,
              1.9,
              10.75
            ],
            "stack_l": [
              1.6,
              9.6,
              -5
            ],
            "stack_r": [
              -1.6,
              9.6,
              -5
            ],
            "wake_origin": [
              0,
              0,
              -9.6
            ]
          },
          "meshes": [
            "body"
          ]
        },
        "cruise_ship": {
          "kind": "ship",
          "length": 297,
          "beam": 37.2,
          "draft": 8.6,
          "freeboard": 14.5,
          "deckY": 49.5,
          "top": 67,
          "bbox": [
            [
              -21.27,
              -8.6,
              -146.4
            ],
            [
              21.27,
              67,
              151
            ]
          ],
          "boxes": [
            [
              5,
              16.2,
              124,
              7,
              18.2,
              126,
              0,
              "capstan"
            ],
            [
              -7,
              16.2,
              124,
              -5,
              18.2,
              126,
              0,
              "capstan"
            ],
            [
              -18.6,
              -8.6,
              -146,
              18.6,
              14.5,
              151,
              4,
              "deck_hull"
            ],
            [
              -16.2,
              14.5,
              -128,
              16.2,
              18,
              104,
              4,
              "tier0"
            ],
            [
              -18.9,
              18,
              -138,
              18.9,
              44,
              112,
              4,
              "tierA"
            ],
            [
              -16.5,
              44,
              -122,
              16.5,
              49.5,
              92,
              4,
              "tierB"
            ],
            [
              -12,
              49.5,
              -100,
              12,
              53.5,
              30,
              4,
              "tierC"
            ],
            [
              -5.5,
              53.5,
              -96,
              5.5,
              67,
              -74,
              0,
              "funnel"
            ],
            [
              -21,
              38,
              102,
              21,
              41,
              106.5,
              4,
              "bridge"
            ],
            [
              -3,
              49.5,
              57,
              3,
              55,
              63,
              0,
              "dome"
            ],
            [
              14.49,
              49.5,
              -121.7,
              15.1,
              50.9,
              -121.45,
              2,
              "windbreak"
            ],
            [
              15.1,
              49.5,
              -121.45,
              15.7,
              50.9,
              -121.2,
              2,
              "windbreak"
            ],
            [
              15.7,
              49.5,
              -121.2,
              15.95,
              50.9,
              -120.6,
              2,
              "windbreak"
            ],
            [
              15.95,
              49.5,
              -120.6,
              16.2,
              50.9,
              -120,
              2,
              "windbreak"
            ],
            [
              16.15,
              49.5,
              -120,
              16.25,
              50.9,
              81,
              2,
              "windbreak"
            ],
            [
              15.85,
              49.5,
              81,
              16.2,
              50.9,
              81.84,
              2,
              "windbreak"
            ],
            [
              15.5,
              49.5,
              81.84,
              15.85,
              50.9,
              82.68,
              2,
              "windbreak"
            ],
            [
              15.16,
              49.5,
              82.68,
              15.5,
              50.9,
              83.52,
              2,
              "windbreak"
            ],
            [
              14.81,
              49.5,
              83.52,
              15.16,
              50.9,
              84.36,
              2,
              "windbreak"
            ],
            [
              14.46,
              49.5,
              84.36,
              14.81,
              50.9,
              85.2,
              2,
              "windbreak"
            ],
            [
              14.11,
              49.5,
              85.2,
              14.46,
              50.9,
              86.04,
              2,
              "windbreak"
            ],
            [
              13.76,
              49.5,
              86.04,
              14.11,
              50.9,
              86.88,
              2,
              "windbreak"
            ],
            [
              13.41,
              49.5,
              86.88,
              13.76,
              50.9,
              87.72,
              2,
              "windbreak"
            ],
            [
              13.07,
              49.5,
              87.72,
              13.41,
              50.9,
              88.57,
              2,
              "windbreak"
            ],
            [
              12.22,
              49.5,
              88.57,
              13.07,
              50.9,
              88.91,
              2,
              "windbreak"
            ],
            [
              11.37,
              49.5,
              88.91,
              12.22,
              50.9,
              89.26,
              2,
              "windbreak"
            ],
            [
              10.53,
              49.5,
              89.26,
              11.37,
              50.9,
              89.61,
              2,
              "windbreak"
            ],
            [
              9.68,
              49.5,
              89.61,
              10.53,
              50.9,
              89.96,
              2,
              "windbreak"
            ],
            [
              8.83,
              49.5,
              89.96,
              9.68,
              50.9,
              90.31,
              2,
              "windbreak"
            ],
            [
              7.99,
              49.5,
              90.31,
              8.83,
              50.9,
              90.66,
              2,
              "windbreak"
            ],
            [
              7.14,
              49.5,
              90.66,
              7.99,
              50.9,
              91.01,
              2,
              "windbreak"
            ],
            [
              6.3,
              49.5,
              91.01,
              7.14,
              50.9,
              91.36,
              2,
              "windbreak"
            ],
            [
              5.45,
              49.5,
              91.36,
              6.3,
              50.9,
              91.7,
              2,
              "windbreak"
            ],
            [
              -5.45,
              49.5,
              91.65,
              5.45,
              50.9,
              91.75,
              2,
              "windbreak"
            ],
            [
              -6.29,
              49.5,
              91.36,
              -5.45,
              50.9,
              91.7,
              2,
              "windbreak"
            ],
            [
              -7.14,
              49.5,
              91.01,
              -6.3,
              50.9,
              91.36,
              2,
              "windbreak"
            ],
            [
              -7.99,
              49.5,
              90.66,
              -7.14,
              50.9,
              91.01,
              2,
              "windbreak"
            ],
            [
              -8.83,
              49.5,
              90.31,
              -7.99,
              50.9,
              90.66,
              2,
              "windbreak"
            ],
            [
              -9.68,
              49.5,
              89.96,
              -8.83,
              50.9,
              90.31,
              2,
              "windbreak"
            ],
            [
              -10.53,
              49.5,
              89.61,
              -9.68,
              50.9,
              89.96,
              2,
              "windbreak"
            ],
            [
              -11.37,
              49.5,
              89.26,
              -10.53,
              50.9,
              89.61,
              2,
              "windbreak"
            ],
            [
              -12.22,
              49.5,
              88.91,
              -11.37,
              50.9,
              89.26,
              2,
              "windbreak"
            ],
            [
              -13.07,
              49.5,
              88.57,
              -12.22,
              50.9,
              88.91,
              2,
              "windbreak"
            ],
            [
              -13.41,
              49.5,
              87.72,
              -13.07,
              50.9,
              88.57,
              2,
              "windbreak"
            ],
            [
              -13.76,
              49.5,
              86.88,
              -13.41,
              50.9,
              87.72,
              2,
              "windbreak"
            ],
            [
              -14.11,
              49.5,
              86.04,
              -13.76,
              50.9,
              86.88,
              2,
              "windbreak"
            ],
            [
              -14.46,
              49.5,
              85.2,
              -14.11,
              50.9,
              86.04,
              2,
              "windbreak"
            ],
            [
              -14.81,
              49.5,
              84.36,
              -14.46,
              50.9,
              85.2,
              2,
              "windbreak"
            ],
            [
              -15.15,
              49.5,
              83.52,
              -14.81,
              50.9,
              84.36,
              2,
              "windbreak"
            ],
            [
              -15.5,
              49.5,
              82.68,
              -15.15,
              50.9,
              83.52,
              2,
              "windbreak"
            ],
            [
              -15.85,
              49.5,
              81.84,
              -15.5,
              50.9,
              82.68,
              2,
              "windbreak"
            ],
            [
              -16.2,
              49.5,
              81,
              -15.85,
              50.9,
              81.84,
              2,
              "windbreak"
            ],
            [
              -16.25,
              49.5,
              -120,
              -16.15,
              50.9,
              81,
              2,
              "windbreak"
            ],
            [
              -16.2,
              49.5,
              -120.6,
              -15.95,
              50.9,
              -120,
              2,
              "windbreak"
            ],
            [
              -15.95,
              49.5,
              -121.2,
              -15.7,
              50.9,
              -120.6,
              2,
              "windbreak"
            ],
            [
              -15.7,
              49.5,
              -121.45,
              -15.1,
              50.9,
              -121.2,
              2,
              "windbreak"
            ],
            [
              -15.1,
              49.5,
              -121.7,
              -14.49,
              50.9,
              -121.45,
              2,
              "windbreak"
            ],
            [
              -14.49,
              49.5,
              -121.75,
              14.49,
              50.9,
              -121.65,
              2,
              "windbreak"
            ],
            [
              9.99,
              53.5,
              -99.7,
              10.6,
              54.9,
              -99.45,
              2,
              "windbreak"
            ],
            [
              10.6,
              53.5,
              -99.45,
              11.2,
              54.9,
              -99.2,
              2,
              "windbreak"
            ],
            [
              11.2,
              53.5,
              -99.2,
              11.45,
              54.9,
              -98.6,
              2,
              "windbreak"
            ],
            [
              11.45,
              53.5,
              -98.6,
              11.7,
              54.9,
              -98,
              2,
              "windbreak"
            ],
            [
              11.65,
              53.5,
              -98,
              11.75,
              54.9,
              24,
              2,
              "windbreak"
            ],
            [
              11.37,
              53.5,
              24,
              11.7,
              54.9,
              24.8,
              2,
              "windbreak"
            ],
            [
              11.03,
              53.5,
              24.8,
              11.37,
              54.9,
              25.61,
              2,
              "windbreak"
            ],
            [
              10.7,
              53.5,
              25.61,
              11.03,
              54.9,
              26.42,
              2,
              "windbreak"
            ],
            [
              10.36,
              53.5,
              26.42,
              10.7,
              54.9,
              27.22,
              2,
              "windbreak"
            ],
            [
              10.03,
              53.5,
              27.22,
              10.36,
              54.9,
              28.03,
              2,
              "windbreak"
            ],
            [
              9.22,
              53.5,
              28.03,
              10.03,
              54.9,
              28.37,
              2,
              "windbreak"
            ],
            [
              8.41,
              53.5,
              28.37,
              9.22,
              54.9,
              28.7,
              2,
              "windbreak"
            ],
            [
              7.59,
              53.5,
              28.7,
              8.41,
              54.9,
              29.03,
              2,
              "windbreak"
            ],
            [
              6.78,
              53.5,
              29.03,
              7.59,
              54.9,
              29.37,
              2,
              "windbreak"
            ],
            [
              5.97,
              53.5,
              29.37,
              6.78,
              54.9,
              29.7,
              2,
              "windbreak"
            ],
            [
              -5.97,
              53.5,
              29.65,
              5.97,
              54.9,
              29.75,
              2,
              "windbreak"
            ],
            [
              -6.78,
              53.5,
              29.37,
              -5.97,
              54.9,
              29.7,
              2,
              "windbreak"
            ],
            [
              -7.59,
              53.5,
              29.03,
              -6.78,
              54.9,
              29.37,
              2,
              "windbreak"
            ],
            [
              -8.41,
              53.5,
              28.7,
              -7.59,
              54.9,
              29.03,
              2,
              "windbreak"
            ],
            [
              -9.22,
              53.5,
              28.37,
              -8.41,
              54.9,
              28.7,
              2,
              "windbreak"
            ],
            [
              -10.03,
              53.5,
              28.03,
              -9.22,
              54.9,
              28.37,
              2,
              "windbreak"
            ],
            [
              -10.36,
              53.5,
              27.22,
              -10.03,
              54.9,
              28.03,
              2,
              "windbreak"
            ],
            [
              -10.7,
              53.5,
              26.42,
              -10.36,
              54.9,
              27.22,
              2,
              "windbreak"
            ],
            [
              -11.03,
              53.5,
              25.61,
              -10.7,
              54.9,
              26.42,
              2,
              "windbreak"
            ],
            [
              -11.37,
              53.5,
              24.8,
              -11.03,
              54.9,
              25.61,
              2,
              "windbreak"
            ],
            [
              -11.7,
              53.5,
              24,
              -11.37,
              54.9,
              24.8,
              2,
              "windbreak"
            ],
            [
              -11.75,
              53.5,
              -98,
              -11.65,
              54.9,
              24,
              2,
              "windbreak"
            ],
            [
              -11.7,
              53.5,
              -98.6,
              -11.45,
              54.9,
              -98,
              2,
              "windbreak"
            ],
            [
              -11.45,
              53.5,
              -99.2,
              -11.2,
              54.9,
              -98.6,
              2,
              "windbreak"
            ],
            [
              -11.2,
              53.5,
              -99.45,
              -10.6,
              54.9,
              -99.2,
              2,
              "windbreak"
            ],
            [
              -10.6,
              53.5,
              -99.7,
              -9.99,
              54.9,
              -99.45,
              2,
              "windbreak"
            ],
            [
              -9.99,
              53.5,
              -99.75,
              9.99,
              54.9,
              -99.65,
              2,
              "windbreak"
            ]
          ],
          "decks": [
            [
              -18.7,
              -137.8,
              18.7,
              -122.2,
              44,
              "tierA_roof"
            ],
            [
              -16.1,
              -121.6,
              16.1,
              81,
              49.5,
              "lido_deck"
            ],
            [
              -12,
              81,
              12,
              88,
              49.5,
              "lido_deck_fwd"
            ],
            [
              -11.6,
              -99.6,
              11.6,
              24,
              53.5,
              "sun_deck"
            ],
            [
              -8,
              24,
              8,
              28,
              53.5,
              "sun_deck_fwd"
            ],
            [
              -14.5,
              -145,
              14.5,
              -128.2,
              14.5,
              "stern_mooring"
            ]
          ],
          "ramps": [
            [
              -11.42,
              112,
              11.43,
              124,
              15.54,
              16.69,
              "z",
              1
            ],
            [
              -8.21,
              124,
              8.22,
              136,
              16.69,
              18.06,
              "z",
              1
            ],
            [
              -4.11,
              136,
              4.11,
              146,
              18.06,
              19.33,
              "z",
              1
            ]
          ],
          "edges": [
            [
              -18.6,
              -146.1,
              18.6,
              -146,
              14.5,
              15.5
            ],
            [
              -18.6,
              151,
              18.6,
              151.1,
              14.5,
              15.5
            ],
            [
              -18.7,
              -146,
              -18.6,
              151,
              14.5,
              15.5
            ],
            [
              18.6,
              -146,
              18.7,
              151,
              14.5,
              15.5
            ],
            [
              -18.9,
              -138.1,
              18.9,
              -138,
              44,
              45
            ],
            [
              -18.9,
              112,
              18.9,
              112.1,
              44,
              45
            ],
            [
              -19,
              -138,
              -18.9,
              112,
              44,
              45
            ],
            [
              18.9,
              -138,
              19,
              112,
              44,
              45
            ],
            [
              -16.5,
              -122.1,
              16.5,
              -122,
              49.5,
              50.5
            ],
            [
              -16.5,
              92,
              16.5,
              92.1,
              49.5,
              50.5
            ],
            [
              -16.6,
              -122,
              -16.5,
              92,
              49.5,
              50.5
            ],
            [
              16.5,
              -122,
              16.6,
              92,
              49.5,
              50.5
            ],
            [
              -12,
              -100.1,
              12,
              -100,
              53.5,
              54.5
            ],
            [
              -12,
              30,
              12,
              30.1,
              53.5,
              54.5
            ],
            [
              -12.1,
              -100,
              -12,
              30,
              53.5,
              54.5
            ],
            [
              12,
              -100,
              12.1,
              30,
              53.5,
              54.5
            ],
            [
              -21,
              101.9,
              -18.8,
              102,
              41,
              42
            ],
            [
              19,
              101.9,
              21,
              102,
              41,
              42
            ],
            [
              -21,
              106.5,
              -18.8,
              106.6,
              41,
              42
            ],
            [
              19,
              106.5,
              21,
              106.6,
              41,
              42
            ],
            [
              -21.1,
              102,
              -21,
              106.5,
              41,
              42
            ],
            [
              21,
              102,
              21.1,
              106.5,
              41,
              42
            ]
          ],
          "gaps": [],
          "empties": {
            "bow": [
              0,
              0,
              151
            ],
            "horn": [
              0,
              66,
              -78
            ],
            "light_mast": [
              0,
              60.3,
              98
            ],
            "stack": [
              0,
              67,
              -85
            ],
            "stern": [
              0,
              0,
              -146
            ]
          },
          "meshes": [
            "body",
            "glass"
          ]
        }
      }
    },
    "levels/vtol.json": {
      "_comment": "AUTO-GENERATED by tools/gen/vtol_build.py from source/models/mirrsona_vtol (do not edit by hand). Vehicle frame: metres, +Y up, nose +Z, +X = port, wheels on y 0 with the gear out. Fields marked approx are best-effort estimates from the source geometry.",
      "version": 1,
      "meta": {
        "length": 24.799999999999997,
        "span": 44,
        "height": 5.519,
        "bbox": [
          [
            -22,
            0,
            -13.2
          ],
          [
            22,
            5.518804823342175,
            11.6
          ]
        ],
        "floorY": 2.05,
        "podHoverRotX": -90,
        "rampOpenDeg": -30.43,
        "cargoDoorOpenDeg": 90,
        "layout": "jeep",
        "tris": {
          "sd/vtol.glb": 40000,
          "sd/vtol_interior.glb": 17998,
          "hd/vtol.glb": 120000,
          "hd/vtol_interior.glb": 49999,
          "models/vtol_far.glb": 2038
        }
      },
      "pods": [
        {
          "node": "pod_l",
          "pivot": [
            8.2,
            2.65,
            -2
          ],
          "axis": [
            1,
            0,
            0
          ],
          "cruiseDeg": 0,
          "hoverDeg": -90,
          "nozzles": [
            [
              -0.88,
              0.0212,
              -1.6799
            ],
            [
              0.88,
              0.0244,
              -1.6799
            ]
          ],
          "nozzleDir": [
            0,
            0,
            -1
          ],
          "nozzleR": 0.47
        },
        {
          "node": "pod_r",
          "pivot": [
            -8.2,
            2.65,
            -2
          ],
          "axis": [
            1,
            0,
            0
          ],
          "cruiseDeg": 0,
          "hoverDeg": -90,
          "nozzles": [
            [
              -0.88,
              0.0244,
              -1.6799
            ],
            [
              0.88,
              0.0212,
              -1.6799
            ]
          ],
          "nozzleDir": [
            0,
            0,
            -1
          ],
          "nozzleR": 0.47
        }
      ],
      "cruiseNozzles": [
        {
          "p": [
            7.2073,
            2.67,
            -10.7836
          ],
          "d": [
            0.2425,
            0,
            -0.9701
          ],
          "r": 0.6
        },
        {
          "p": [
            9.2073,
            2.67,
            -10.2577
          ],
          "d": [
            0.2425,
            0,
            -0.9701
          ],
          "r": 0.6
        },
        {
          "p": [
            -7.2073,
            2.67,
            -10.7836
          ],
          "d": [
            -0.2425,
            0,
            -0.9701
          ],
          "r": 0.6
        },
        {
          "p": [
            -9.2073,
            2.67,
            -10.2577
          ],
          "d": [
            -0.2425,
            0,
            -0.9701
          ],
          "r": 0.6
        }
      ],
      "hull": [
        {
          "x": 0,
          "y": 3,
          "z": -10.6,
          "r": 1.63
        },
        {
          "x": 0,
          "y": 3.2,
          "z": -3.87,
          "r": 2.35
        },
        {
          "x": 0,
          "y": 3.31,
          "z": 2.87,
          "r": 2.4
        },
        {
          "x": 0,
          "y": 2.87,
          "z": 9.6,
          "r": 1.6
        },
        {
          "x": 5,
          "y": 2.86,
          "z": 1.53,
          "r": 1.52
        },
        {
          "x": 8.16,
          "y": 2.67,
          "z": -0.19,
          "r": 1.22
        },
        {
          "x": 11.32,
          "y": 2.65,
          "z": -2.28,
          "r": 0.86
        },
        {
          "x": 14.48,
          "y": 2.65,
          "z": -2.93,
          "r": 0.73
        },
        {
          "x": 17.64,
          "y": 2.66,
          "z": -3.66,
          "r": 0.6
        },
        {
          "x": 20.8,
          "y": 2.65,
          "z": -3.67,
          "r": 0.6
        },
        {
          "x": -5,
          "y": 2.86,
          "z": 1.53,
          "r": 1.52
        },
        {
          "x": -8.16,
          "y": 2.67,
          "z": -0.19,
          "r": 1.22
        },
        {
          "x": -11.32,
          "y": 2.65,
          "z": -2.28,
          "r": 0.86
        },
        {
          "x": -14.48,
          "y": 2.65,
          "z": -2.79,
          "r": 0.73
        },
        {
          "x": -17.64,
          "y": 2.66,
          "z": -3.66,
          "r": 0.6
        },
        {
          "x": -20.8,
          "y": 2.65,
          "z": -3.67,
          "r": 0.6
        }
      ],
      "hullNote": "approx: spheres along the fuselage and the wing span (mid thickness); the thin outer wing is covered by the boxes",
      "boxes": [
        {
          "x0": -3.6,
          "y0": 1.02,
          "z0": -13.2,
          "x1": 3.6,
          "y1": 5.52,
          "z1": 11.6,
          "tag": "fuselage"
        },
        {
          "x0": 3.6,
          "y0": 1.5,
          "z0": -12.33,
          "x1": 22,
          "y1": 4.29,
          "z1": 9.28,
          "tag": "wing_l"
        },
        {
          "x0": -22,
          "y0": 1.5,
          "z0": -12.33,
          "x1": -3.6,
          "y1": 4.29,
          "z1": 9.28,
          "tag": "wing_r"
        },
        {
          "x0": 6.24,
          "y0": 1.71,
          "z0": -4.03,
          "x1": 10.16,
          "y1": 3.62,
          "z1": 0.03,
          "tag": "pod_l",
          "node": "pod_l"
        },
        {
          "x0": -10.16,
          "y0": 1.71,
          "z0": -4.03,
          "x1": -6.24,
          "y1": 3.62,
          "z1": 0.03,
          "tag": "pod_r",
          "node": "pod_r"
        },
        {
          "x0": -1.37,
          "y0": 1.27,
          "z0": -9,
          "x1": 1.37,
          "y1": 2.05,
          "z1": -6.6,
          "tag": "ramp",
          "node": "ramp"
        },
        {
          "x0": -1.45,
          "y0": 1.51,
          "z0": -13.2,
          "x1": 1.45,
          "y1": 3.87,
          "z1": -9,
          "tag": "cargo_door",
          "node": "cargo_door"
        }
      ],
      "contacts": [
        {
          "gear": "n",
          "x": 0,
          "y": 0,
          "z": 4.4,
          "wheelR": 0.373
        },
        {
          "gear": "l",
          "x": 4.1,
          "y": 0,
          "z": -4,
          "wheelR": 0.548
        },
        {
          "gear": "r",
          "x": -4.1,
          "y": 0,
          "z": -4,
          "wheelR": 0.548
        },
        {
          "gear": "belly",
          "x": 0,
          "y": 1.02,
          "z": 0.919
        }
      ],
      "cabin": {
        "floorY": 2.05,
        "walk": [
          {
            "tag": "cabin",
            "x0": -2.873,
            "z0": -2.4,
            "x1": 2.873,
            "z1": 8.802,
            "y": 2.05
          },
          {
            "tag": "cargo",
            "x0": -2.862,
            "z0": -6.6,
            "x1": 2.862,
            "z1": -2.4,
            "y": 2.05
          }
        ],
        "ramp": {
          "node": "ramp",
          "hinge": "x",
          "pivot": [
            0,
            2.05,
            -6.6
          ],
          "openDeg": -30.43,
          "length": 2.4,
          "width": [
            2.734,
            2.28
          ],
          "tFwd": 0.827,
          "tAft": 0.539,
          "chamfer": 0.536
        },
        "toe": {
          "node": "ramp_toe",
          "parent": "ramp",
          "axis": [
            0,
            0,
            -1
          ],
          "slide": 1.652,
          "halfWidth": 1.06,
          "length": -7.97,
          "exposed": 1.622,
          "top": -0.015
        },
        "cargoDoor": {
          "node": "cargo_door",
          "hinge": [
            0,
            3.871,
            -10.35
          ],
          "axis": [
            1,
            0,
            0
          ],
          "openDeg": 90,
          "minDeg": 76,
          "halfWidth": 1.45,
          "z": [
            -13.2,
            -9
          ]
        },
        "profile": {
          "edgeZ": -6.6,
          "floorY": 2.05,
          "footZ": -10.09,
          "deg": 30.43
        },
        "opening": {
          "halfWidth": 1.14,
          "clear": [
            [
              -11.59,
              6.51
            ],
            [
              -11.34,
              6.18
            ],
            [
              -11.09,
              5.48
            ],
            [
              -10.84,
              4.8
            ],
            [
              -10.59,
              4.2
            ],
            [
              -10.34,
              3.52
            ],
            [
              -10.09,
              3.52
            ],
            [
              -9.84,
              3.37
            ],
            [
              -9.59,
              3.22
            ],
            [
              -9.34,
              3.08
            ],
            [
              -9.09,
              2.93
            ],
            [
              -8.84,
              3.67
            ],
            [
              -8.59,
              3.6
            ],
            [
              -8.34,
              3.51
            ],
            [
              -8.09,
              3.43
            ],
            [
              -7.84,
              3.33
            ],
            [
              -7.59,
              3.24
            ],
            [
              -7.34,
              3.12
            ],
            [
              -7.09,
              3.01
            ],
            [
              -6.84,
              2.9
            ],
            [
              -6.59,
              2.79
            ],
            [
              -6.34,
              2.75
            ],
            [
              -6.09,
              2.84
            ],
            [
              -5.84,
              2.83
            ],
            [
              -5.59,
              2.83
            ],
            [
              -5.34,
              2.83
            ],
            [
              -5.09,
              2.83
            ],
            [
              -4.84,
              2.86
            ],
            [
              -4.59,
              2.89
            ],
            [
              -4.34,
              2.93
            ],
            [
              -4.09,
              2.93
            ],
            [
              -3.84,
              2.93
            ],
            [
              -3.59,
              2.93
            ],
            [
              -3.34,
              2.93
            ],
            [
              -3.09,
              3.01
            ],
            [
              -2.84,
              3.01
            ],
            [
              -2.59,
              3.02
            ]
          ],
          "note": "clear = lowest structure above the line (min over |x| <= 1.0), open pose"
        },
        "rampProxy": [
          [
            -1.26,
            -8,
            1.26,
            -6.6,
            1.228,
            2.05,
            "z",
            1
          ],
          [
            -1.14,
            -8.669,
            1.14,
            -8,
            0.835,
            1.228,
            "z",
            1
          ],
          [
            -1.06,
            -10.09,
            1.06,
            -8.669,
            0,
            0.835,
            "z",
            1
          ]
        ],
        "rampProxyNote": "ships.json ramp format [x0, z0, x1, z1, y0, y1, axis, dir] (platforms.js: tag stairs, t 0.3); widths = the visible deck / toe",
        "hull": [
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -6.6,
            "x1": 3.6,
            "y1": 2.05,
            "z1": 11.6,
            "tag": "belly"
          },
          {
            "x0": 1.39,
            "y0": 1.02,
            "z0": -9,
            "x1": 3.6,
            "y1": 2.05,
            "z1": -6.6,
            "tag": "belly_l"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -9,
            "x1": -1.39,
            "y1": 2.05,
            "z1": -6.6,
            "tag": "belly_r"
          },
          {
            "x0": -3.6,
            "y0": 5.13,
            "z0": -9,
            "x1": 3.6,
            "y1": 5.52,
            "z1": 11.6,
            "tag": "roof"
          },
          {
            "x0": 2.95,
            "y0": 1.02,
            "z0": -9,
            "x1": 3.6,
            "y1": 5.52,
            "z1": 11.6,
            "tag": "side_l"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -9,
            "x1": -2.95,
            "y1": 5.52,
            "z1": 11.6,
            "tag": "side_r"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": 9.1,
            "x1": 3.6,
            "y1": 5.52,
            "z1": 11.6,
            "tag": "nose"
          },
          {
            "x0": 1.45,
            "y0": 1.02,
            "z0": -13.2,
            "x1": 3.6,
            "y1": 5.52,
            "z1": -9,
            "tag": "tail_l"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -13.2,
            "x1": -1.45,
            "y1": 5.52,
            "z1": -9,
            "tag": "tail_r"
          },
          {
            "x0": -1.45,
            "y0": 3.52,
            "z0": -10.35,
            "x1": 1.45,
            "y1": 5.52,
            "z1": -9,
            "tag": "tail_top"
          },
          {
            "x0": 1.3,
            "y0": 2.05,
            "z0": -8.9,
            "x1": 3,
            "y1": 5.13,
            "z1": -8.86,
            "tag": "bulkhead_l"
          },
          {
            "x0": -3,
            "y0": 2.05,
            "z0": -8.9,
            "x1": -1.3,
            "y1": 5.13,
            "z1": -8.86,
            "tag": "bulkhead_r"
          },
          {
            "x0": -1.3,
            "y0": 4,
            "z0": -8.9,
            "x1": 1.3,
            "y1": 5.13,
            "z1": -8.86,
            "tag": "bulkhead_top"
          },
          {
            "x0": -1.45,
            "y0": 1.51,
            "z0": -13.2,
            "x1": 1.45,
            "y1": 3.87,
            "z1": -9,
            "tag": "cargo_door",
            "node": "cargo_door",
            "closedOnly": true
          }
        ],
        "los": [
          {
            "x0": -3.6,
            "y0": 5.13,
            "z0": -13.2,
            "x1": 3.6,
            "y1": 5.52,
            "z1": 11.6,
            "tag": "roof"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -6.6,
            "x1": 3.6,
            "y1": 2.05,
            "z1": 11.6,
            "tag": "floor_slab"
          },
          {
            "x0": -3.6,
            "y0": 1.02,
            "z0": -13.2,
            "x1": 3.6,
            "y1": 5.52,
            "z1": -9,
            "tag": "tail",
            "closedOnly": true
          }
        ],
        "sweep": {
          "pad": 0.3,
          "note": "side-view (z, y) convex polygons swept while opening / closing; x within +-halfWidth",
          "plate": {
            "halfWidth": 1.368,
            "zy": [
              [
                -9,
                1.555
              ],
              [
                -9,
                1.511
              ],
              [
                -8.974,
                1.405
              ],
              [
                -8.943,
                1.3
              ],
              [
                -8.907,
                1.198
              ],
              [
                -8.867,
                1.096
              ],
              [
                -8.823,
                0.997
              ],
              [
                -8.774,
                0.9
              ],
              [
                -8.721,
                0.805
              ],
              [
                -8.664,
                0.712
              ],
              [
                -8.603,
                0.622
              ],
              [
                -8.538,
                0.535
              ],
              [
                -8.469,
                0.45
              ],
              [
                -8.396,
                0.369
              ],
              [
                -7.371,
                0.795
              ],
              [
                -6.693,
                1.093
              ],
              [
                -6.641,
                1.118
              ],
              [
                -6.64,
                1.144
              ],
              [
                -6.6,
                2.05
              ],
              [
                -9,
                2.05
              ]
            ]
          },
          "toe": {
            "halfWidth": 1.06,
            "zy": [
              [
                -10.622,
                2.035
              ],
              [
                -10.617,
                1.857
              ],
              [
                -10.605,
                1.68
              ],
              [
                -10.585,
                1.503
              ],
              [
                -10.557,
                1.327
              ],
              [
                -10.521,
                1.153
              ],
              [
                -10.477,
                0.98
              ],
              [
                -10.426,
                0.81
              ],
              [
                -10.367,
                0.641
              ],
              [
                -10.301,
                0.476
              ],
              [
                -10.228,
                0.314
              ],
              [
                -10.148,
                0.155
              ],
              [
                -10.06,
                0
              ],
              [
                -9.942,
                0
              ],
              [
                -9.467,
                0.279
              ],
              [
                -8.517,
                0.837
              ],
              [
                -7.36,
                1.517
              ],
              [
                -7.122,
                1.656
              ],
              [
                -7.25,
                2.035
              ]
            ]
          },
          "door": {
            "halfWidth": 1.45,
            "zy": [
              [
                -13.45,
                3.834
              ],
              [
                -13.419,
                3.429
              ],
              [
                -13.335,
                3.032
              ],
              [
                -13.2,
                2.65
              ],
              [
                -13.17,
                2.594
              ],
              [
                -13.136,
                2.566
              ],
              [
                -12.014,
                1.72
              ],
              [
                -11.719,
                1.521
              ],
              [
                -11.401,
                1.362
              ],
              [
                -11.065,
                1.247
              ],
              [
                -10.716,
                1.176
              ],
              [
                -10.361,
                1.151
              ],
              [
                -10.006,
                1.173
              ],
              [
                -9.657,
                1.241
              ],
              [
                -9.32,
                1.354
              ],
              [
                -9,
                1.51
              ],
              [
                -9,
                1.532
              ],
              [
                -9,
                1.593
              ],
              [
                -9,
                1.631
              ],
              [
                -11.333,
                6.4
              ],
              [
                -11.409,
                6.55
              ],
              [
                -11.467,
                6.631
              ],
              [
                -11.484,
                6.653
              ],
              [
                -11.514,
                6.691
              ],
              [
                -11.571,
                6.721
              ],
              [
                -11.932,
                6.537
              ],
              [
                -12.267,
                6.308
              ],
              [
                -12.568,
                6.037
              ],
              [
                -12.832,
                5.728
              ],
              [
                -13.053,
                5.389
              ],
              [
                -13.228,
                5.023
              ],
              [
                -13.354,
                4.637
              ],
              [
                -13.428,
                4.239
              ]
            ]
          }
        },
        "cargo": {
          "slots": [
            {
              "x": 0,
              "zFront": -3.36,
              "floorY": 2.05,
              "aisle": 0.9,
              "maxW": 2.08,
              "maxH": 1.95,
              "maxLen": 4.4,
              "axleBehindHingeMax": 0.25
            }
          ],
          "zone": {
            "halfW": 3,
            "z0": -20.09,
            "z1": -9.59
          },
          "alignZ": -13.09,
          "exitClear": 2,
          "autoExit": [
            1.75,
            2.05,
            -5.2
          ],
          "lane": {
            "halfW": 1.4,
            "pad": 0.5
          },
          "checked": [
            "jeep"
          ],
          "layout": "jeep",
          "partitionZ": [
            -2.46,
            -2.34
          ]
        },
        "bounds": {
          "x0": -3.48,
          "y0": 1.22,
          "z0": -8.88,
          "x1": 3.48,
          "y1": 5.13,
          "z1": 9.88,
          "approx": true
        },
        "ceilingY": 5.13,
        "walls": [
          {
            "x0": 2.95,
            "x1": 3.58,
            "y0": 2.05,
            "y1": 5.13,
            "z0": -2.46,
            "z1": 9.88,
            "tag": "wall_l_wall_cabin",
            "approx": true
          },
          {
            "x0": -3.58,
            "x1": -2.95,
            "y0": 2.05,
            "y1": 5.13,
            "z0": -2.46,
            "z1": 9.88,
            "tag": "wall_r_wall_cabin",
            "approx": true
          },
          {
            "x0": 2.95,
            "x1": 3.56,
            "y0": 2.05,
            "y1": 5.13,
            "z0": -8.88,
            "z1": -2.46,
            "tag": "wall_l_wall_cargo",
            "approx": true
          },
          {
            "x0": -3.56,
            "x1": -2.95,
            "y0": 2.05,
            "y1": 5.13,
            "z0": -8.88,
            "z1": -2.46,
            "tag": "wall_r_wall_cargo",
            "approx": true
          },
          {
            "x0": -2.873,
            "x1": 2.873,
            "y0": 2.05,
            "y1": 5.13,
            "z0": 8.802,
            "z1": 9.1,
            "tag": "nose",
            "approx": true
          },
          {
            "x0": -3.45,
            "x1": -0.61,
            "y0": 2.05,
            "y1": 5.12,
            "z0": -2.46,
            "z1": -2.34,
            "tag": "partition_-2.40_r"
          },
          {
            "x0": 0.61,
            "x1": 3.45,
            "y0": 2.05,
            "y1": 5.12,
            "z0": -2.46,
            "z1": -2.34,
            "tag": "partition_-2.40_l"
          },
          {
            "x0": -0.61,
            "x1": 0.61,
            "y0": 4.01,
            "y1": 5.12,
            "z0": -2.46,
            "z1": -2.34,
            "tag": "partition_-2.40_header",
            "door": {
              "halfWidth": 0.61,
              "x": 0,
              "clear": 1.96
            }
          },
          {
            "x0": -3.42,
            "x1": -0.55,
            "y0": 2.05,
            "y1": 5.12,
            "z0": 1.54,
            "z1": 1.66,
            "tag": "partition_+1.60_r"
          },
          {
            "x0": 0.55,
            "x1": 3.42,
            "y0": 2.05,
            "y1": 5.12,
            "z0": 1.54,
            "z1": 1.66,
            "tag": "partition_+1.60_l"
          },
          {
            "x0": -0.55,
            "x1": 0.55,
            "y0": 4.01,
            "y1": 5.12,
            "z0": 1.54,
            "z1": 1.66,
            "tag": "partition_+1.60_header",
            "door": {
              "halfWidth": 0.55,
              "x": 0,
              "clear": 1.96
            }
          },
          {
            "x0": -3.05,
            "x1": -1.11,
            "y0": 2.05,
            "y1": 4.66,
            "z0": 5.54,
            "z1": 5.66,
            "tag": "partition_+5.60_r"
          },
          {
            "x0": 1.11,
            "x1": 3.05,
            "y0": 2.05,
            "y1": 4.66,
            "z0": 5.54,
            "z1": 5.66,
            "tag": "partition_+5.60_l"
          },
          {
            "x0": -1.11,
            "x1": 1.11,
            "y0": 4.07,
            "y1": 4.66,
            "z0": 5.54,
            "z1": 5.66,
            "tag": "partition_+5.60_header",
            "door": {
              "halfWidth": 1.11,
              "x": 0,
              "clear": 2.02
            }
          }
        ],
        "furniture": [
          {
            "x0": -2.62,
            "y0": 2.05,
            "z0": -4.47,
            "x1": -1.38,
            "y1": 3,
            "z1": -2.88,
            "tag": "Barrel_Red"
          },
          {
            "x0": -2.71,
            "y0": 2.05,
            "z0": 2,
            "x1": -1.98,
            "y1": 2.91,
            "z1": 4.6,
            "tag": "Cabinet"
          },
          {
            "x0": -2.18,
            "y0": 2.05,
            "z0": 5.95,
            "x1": -1.72,
            "y1": 2.85,
            "z1": 7.05,
            "tag": "Console"
          },
          {
            "x0": -1.4,
            "y0": 2.05,
            "z0": 6.94,
            "x1": 1.4,
            "y1": 3.03,
            "z1": 8.41,
            "tag": "Console"
          },
          {
            "x0": 1.72,
            "y0": 2.05,
            "z0": 5.95,
            "x1": 2.18,
            "y1": 2.85,
            "z1": 7.05,
            "tag": "Console"
          },
          {
            "x0": -2.5,
            "y0": 2.05,
            "z0": -6.23,
            "x1": -1.4,
            "y1": 3.15,
            "z1": -4.67,
            "tag": "Container_Gray"
          },
          {
            "x0": -2.61,
            "y0": 2.05,
            "z0": 4.72,
            "x1": -1.98,
            "y1": 3.75,
            "z1": 5.48,
            "tag": "Fridge"
          },
          {
            "x0": -2.87,
            "y0": 2.05,
            "z0": -1.95,
            "x1": -0.99,
            "y1": 2.41,
            "z1": 0.45,
            "tag": "furniture"
          },
          {
            "x0": -2.85,
            "y0": 2.05,
            "z0": 0.55,
            "x1": -1,
            "y1": 3.75,
            "z1": 1.49,
            "tag": "Locker"
          },
          {
            "x0": 0.99,
            "y0": 2.05,
            "z0": -1.95,
            "x1": 2.87,
            "y1": 2.41,
            "z1": 0.45,
            "tag": "furniture"
          },
          {
            "x0": 1,
            "y0": 2.05,
            "z0": 0.55,
            "x1": 2.85,
            "y1": 3.75,
            "z1": 1.49,
            "tag": "Locker"
          },
          {
            "x0": -1.17,
            "y0": 2.51,
            "z0": 6.47,
            "x1": -0.63,
            "y1": 3.19,
            "z1": 6.69,
            "tag": "Seat_Leather"
          },
          {
            "x0": 0.63,
            "y0": 2.51,
            "z0": 6.47,
            "x1": 1.17,
            "y1": 3.19,
            "z1": 6.69,
            "tag": "Seat_Leather"
          },
          {
            "x0": 1.46,
            "y0": 2.52,
            "z0": 2.05,
            "x1": 3.41,
            "y1": 3.21,
            "z1": 5.15,
            "tag": "Sofa"
          },
          {
            "x0": 1.45,
            "y0": 2.05,
            "z0": 2.2,
            "x1": 2.67,
            "y1": 2.39,
            "z1": 5,
            "tag": "Sofa_Base"
          }
        ],
        "approx": true
      },
      "seats": {
        "seat_pilot": {
          "eye": [
            0.9,
            3.6,
            6.85
          ],
          "yaw": 0,
          "stand": [
            0.9,
            2.05,
            5.05
          ]
        },
        "seat_copilot": {
          "eye": [
            -0.9,
            3.6,
            6.85
          ],
          "yaw": 0,
          "stand": [
            -0.9,
            2.05,
            5.05
          ]
        },
        "seat_0": {
          "eye": [
            2.65,
            3.35,
            2.7
          ],
          "yaw": -90,
          "stand": [
            0.85,
            2.05,
            2.7
          ]
        },
        "seat_1": {
          "eye": [
            2.65,
            3.35,
            3.6
          ],
          "yaw": -90,
          "stand": [
            0.85,
            2.05,
            3.6
          ]
        },
        "seat_2": {
          "eye": [
            2.65,
            3.35,
            4.5
          ],
          "yaw": -90,
          "stand": [
            0.85,
            2.05,
            4.5
          ]
        }
      },
      "exits": {
        "exit_ramp": [
          0,
          0,
          -11.29
        ],
        "exit_l": [
          3.2,
          0,
          -7.972
        ],
        "exit_r": [
          -3.2,
          0,
          -7.972
        ]
      },
      "views": {
        "cockpit": {
          "eye": [
            0,
            3.6999999999999997,
            5.8
          ],
          "yaw": 0,
          "pitch": -4,
          "fov": 72
        },
        "lounge": {
          "eye": [
            -1.45,
            3.67,
            1.95
          ],
          "yaw": 58,
          "pitch": -15,
          "fov": 74
        },
        "bunks": {
          "eye": [
            0,
            3.5999999999999996,
            1.3
          ],
          "yaw": 180,
          "pitch": -7,
          "fov": 74
        },
        "cargo": {
          "eye": [
            0.3,
            3.8,
            -2.75
          ],
          "yaw": 180,
          "pitch": -11,
          "fov": 74
        }
      },
      "lights": [
        [
          0,
          4.05,
          6.4,
          4.2,
          1,
          0.92,
          0.8,
          3.2
        ],
        [
          1.4,
          4.25,
          3.6,
          4.5,
          1,
          0.82,
          0.6,
          3
        ],
        [
          -1.8,
          4.15,
          3.3,
          3.4,
          1,
          0.86,
          0.68,
          1.8
        ],
        [
          2.4,
          4.35,
          3.7,
          2.8,
          1,
          0.24,
          0.6,
          1.1
        ],
        [
          -2.4,
          4.35,
          3.7,
          2.8,
          0.19,
          0.89,
          0.94,
          1.1
        ],
        [
          0,
          4.65,
          -0.3,
          4.5,
          1,
          0.8,
          0.58,
          2.2
        ],
        [
          0,
          4.75,
          -4.4,
          5.5,
          1,
          0.86,
          0.66,
          3
        ],
        [
          0,
          3.55,
          -0.1,
          4.2,
          0.69,
          0.3,
          1,
          2.6
        ]
      ]
    },
    "story/chapters/p0.json": {
      "id": "p0",
      "v": 1,
      "needs": 1,
      "level": "midtown",
      "city": "midtown",
      "title": "序章　スカイハイ陥落",
      "en": "The Fall",
      "caption": [
        "封鎖 1 日目　17:05",
        "MIRRSONA 本社　スカイハイ"
      ],
      "weather": "cloudy",
      "systems": {
        "ambient": 0,
        "airDefense": false,
        "jets": false,
        "boats": false,
        "helis": false,
        "cityVehicles": false
      },
      "loadout": {
        "slots": [
          "rifle",
          null,
          "pistol"
        ],
        "ammo": {
          "556": 160,
          "9mm": 45
        },
        "meds": {
          "bandage": 2,
          "medkit": 1
        },
        "vest": true
      },
      "zones": {
        "dark": []
      },
      "start": {
        "landmark": "skyhigh",
        "d": [
          -16,
          0.15,
          14
        ],
        "yaw": 0
      },
      "anchors": {
        "lift0": {
          "lift": "L0"
        },
        "ren0": {
          "landmark": "skyhigh",
          "d": [
            -13,
            0.15,
            15
          ],
          "yaw": 0
        },
        "ren_deck": {
          "lift": "L1",
          "d": [
            5,
            0,
            7
          ]
        },
        "no7_wait": {
          "landmark": "skyhigh",
          "d": [
            -120,
            260,
            0
          ]
        },
        "no7_near": {
          "landmark": "skyhigh",
          "d": [
            -120,
            140,
            0
          ]
        },
        "lb1": {
          "landmark": "skyhigh",
          "d": [
            -26,
            0.15,
            -4
          ]
        },
        "lb2": {
          "landmark": "skyhigh",
          "d": [
            -14,
            0.15,
            -8
          ]
        },
        "lb3": {
          "landmark": "skyhigh",
          "d": [
            -28,
            0.15,
            -12
          ]
        },
        "lb4": {
          "landmark": "skyhigh",
          "d": [
            -12,
            0.15,
            -14
          ]
        },
        "lb5": {
          "landmark": "skyhigh",
          "d": [
            -20,
            0.15,
            -1
          ]
        },
        "dk1": {
          "landmark": "skyhigh",
          "d": [
            14,
            128,
            -12
          ]
        },
        "dk2": {
          "landmark": "skyhigh",
          "d": [
            16,
            128,
            4
          ]
        },
        "dk3": {
          "landmark": "skyhigh",
          "d": [
            10,
            128,
            10
          ]
        },
        "dk4": {
          "landmark": "skyhigh",
          "d": [
            18,
            128,
            -4
          ]
        },
        "cam_b0": {
          "landmark": "skyhigh",
          "d": [
            -44,
            133,
            6
          ]
        },
        "cam_b1": {
          "landmark": "skyhigh",
          "d": [
            -48,
            140,
            14
          ]
        },
        "look_city": {
          "zone": "times",
          "d": [
            300,
            40,
            0
          ]
        },
        "look_gct": {
          "zone": "gct",
          "d": [
            0,
            20,
            0
          ]
        },
        "lift1": {
          "lift": "L1"
        },
        "roof_pad": {
          "landmark": "skyhigh",
          "d": [
            0,
            274,
            0
          ],
          "yaw": 0
        }
      },
      "actors": {
        "ren": {
          "kind": "ally",
          "name": "レン",
          "look": "crew",
          "weapon": "rifle",
          "at": "ren0",
          "fire": "tagged"
        },
        "no7": {
          "kind": "vtol",
          "name": "七号機",
          "at": "no7_wait",
          "air": true
        }
      },
      "groups": {
        "lobby": {
          "at": [
            "lb1",
            "lb2",
            "lb3",
            "lb4",
            "lb5"
          ],
          "n": 5,
          "roles": [
            "guard",
            "guard",
            "guard",
            "hunt",
            "hunt"
          ],
          "look": "veil",
          "tag": "lobby",
          "hp": 0.9,
          "acc": 0.75
        },
        "perch128": {
          "perch": [
            1,
            2,
            3
          ],
          "lm": "skyhigh",
          "n": 3,
          "role": "overwatch",
          "look": "veil",
          "tag": "snipers",
          "hp": 0.8,
          "acc": 0.45,
          "dmg": 0.8
        },
        "deckwave": {
          "at": [
            "dk1",
            "dk2",
            "dk3",
            "dk4"
          ],
          "n": 2,
          "role": "hunt",
          "look": "veil",
          "tag": "deckwave",
          "waves": 2,
          "gap": 14,
          "acc": 0.7
        }
      },
      "interact": {
        "intel_p0": {
          "at": {
            "landmark": "skyhigh",
            "d": [
              -30,
              0.15,
              -2
            ]
          },
          "label": "端末",
          "verb": "調べる",
          "intel": "p0_1",
          "always": true
        }
      },
      "steps": [
        {
          "id": "lobby",
          "checkpoint": true,
          "obj": "ロビーのヴェール兵を倒す",
          "count": [
            "alive",
            "lobby"
          ],
          "do": [
            [
              "radio",
              "p0_alarm"
            ],
            [
              "spawn",
              "lobby"
            ],
            [
              "ally",
              "ren",
              "follow"
            ]
          ],
          "until": [
            "dead",
            "lobby"
          ]
        },
        {
          "id": "lift",
          "obj": "エレベーターで 128 m のデッキへ",
          "mark": [
            "lift0"
          ],
          "do": [
            [
              "radio",
              "p0_lift"
            ]
          ],
          "until": [
            "lifted",
            "L1"
          ]
        },
        {
          "id": "deck",
          "checkpoint": true,
          "obj": "七号機が来るまでデッキを守る",
          "do": [
            [
              "ally",
              "ren",
              "place",
              "ren_deck"
            ],
            [
              "ally",
              "ren",
              "hold",
              "ren_deck"
            ],
            [
              "spawn",
              "perch128"
            ],
            [
              "spawn",
              "deckwave"
            ],
            [
              "timer",
              60
            ],
            [
              "radio",
              "p0_deck"
            ]
          ],
          "on": [
            {
              "when": [
                "time",
                25
              ],
              "do": [
                [
                  "radio",
                  "p0_haru"
                ]
              ]
            },
            {
              "when": [
                "time",
                40
              ],
              "do": [
                [
                  "radio",
                  "p0_mio"
                ],
                [
                  "vtol",
                  "hover",
                  "roof_pad",
                  0
                ]
              ]
            }
          ],
          "until": [
            "timerDone"
          ]
        },
        {
          "id": "up",
          "checkpoint": true,
          "obj": "エレベーターでスカイフロアへ",
          "mark": [
            "lift1"
          ],
          "do": [
            [
              "radio",
              "p0_up"
            ],
            [
              "ally",
              "ren",
              "follow"
            ]
          ],
          "until": [
            "lifted",
            "L2"
          ]
        },
        {
          "id": "roof",
          "obj": "屋上の七号機に乗る（ランプ）",
          "mark": [
            "@no7.ramp"
          ],
          "do": [
            [
              "despawn",
              "perch128"
            ],
            [
              "despawn",
              "deckwave"
            ],
            [
              "vtol",
              "hover",
              "roof_pad",
              0
            ],
            [
              "vtol",
              "ramp",
              true
            ],
            [
              "vtol",
              "board"
            ],
            [
              "radio",
              "p0_ramp"
            ],
            [
              "ally",
              "ren",
              "board",
              "@no7.ramp"
            ]
          ],
          "until": [
            "boarded"
          ]
        },
        {
          "id": "black",
          "do": [
            [
              "cine",
              "p0_blackout"
            ]
          ],
          "until": [
            "done",
            "p0_blackout"
          ]
        },
        {
          "id": "fin",
          "do": [
            [
              "end",
              "success"
            ]
          ],
          "until": [
            "never"
          ]
        }
      ],
      "fail": [
        [
          "playerDead"
        ]
      ],
      "shots": {
        "p0_blackout": {
          "letterbox": true,
          "hold": 1.2,
          "keys": [
            {
              "t": 0,
              "p": "cam_b0",
              "look": "look_city",
              "fov": 55
            },
            {
              "t": 9,
              "p": "cam_b1",
              "look": "look_gct",
              "fov": 46,
              "ease": "inOut"
            }
          ],
          "lines": "p0_black",
          "pre": [
            [
              "fade",
              0,
              0.8
            ]
          ],
          "blackout": {
            "at": 1,
            "stagger": 0.7,
            "zones": [
              "roosevelt",
              "lic",
              "un",
              "boathouse",
              "hy",
              "carrier",
              "rock",
              "times",
              "library",
              "gct",
              "skyhigh"
            ]
          }
        }
      },
      "lines": {
        "p0_alarm": [
          [
            "haru",
            "侵入者！ロビーに鏡の仮面…\nヴェールです！"
          ],
          [
            "ren",
            "新入り、初日に悪いな。\n撃てるか？"
          ]
        ],
        "p0_lift": [
          [
            "ren",
            "上だ。128 m のデッキで\n七号機を待つ"
          ]
        ],
        "p0_deck": [
          [
            "haru",
            "タワーより七号機。\nデッキに敵、狙撃手もいます"
          ],
          [
            "ren",
            "一分だ。持ちこたえろ"
          ]
        ],
        "p0_haru": [
          [
            "haru",
            "わたしは残って七号機の\n暗号を消します"
          ],
          [
            "ren",
            "ハル、無茶するな"
          ]
        ],
        "p0_mio": [
          [
            "mio",
            "こちら七号機、ミオ。\n屋上のパッドに降りる"
          ]
        ],
        "p0_ramp": [
          [
            "mio",
            "ランプを下ろした。\n乗って！"
          ],
          [
            "genji",
            "新入り、早く！"
          ]
        ],
        "p0_black": [
          [
            "haru",
            "タワー、以上。\n帰ったらお茶にしよ",
            {
              "box": true
            }
          ],
          [
            "mio",
            "……街の灯が消えていく",
            {
              "box": true
            }
          ],
          [
            "ren",
            "ヴェールが送電を止めた。\n地区ごとにな",
            {
              "box": true
            }
          ],
          [
            "genji",
            "ようこそ第七班へ、新入り",
            {
              "box": true
            }
          ],
          [
            "rui",
            "（必ず、この灯を取り戻す）",
            {
              "box": true,
              "inner": true
            }
          ]
        ],
        "p0_up": [
          [
            "mio",
            "降りた。エレベーターで\nスカイフロアから屋上へ"
          ],
          [
            "ren",
            "走れ、新入り"
          ]
        ]
      },
      "intel": [
        {
          "id": "p0_1",
          "title": "ヴェールの通達",
          "body": "第七班の撤収は認めない。\nスカイハイは本日 17:00 をもって「緊急管理」下に置く。\nペルソナ部隊は鏡面バイザーを外すな。"
        }
      ],
      "rewards": {
        "relight": null,
        "unlock": [],
        "next": "c1"
      },
      "rating": {
        "par": 540
      }
    },
    "story/story.json": {
      "v": 1,
      "title": "MIRRSONA ―黄昏便―",
      "en": "MIRRSONA: Dusk Run",
      "hero": "rui",
      "cast": {
        "rui": {
          "name": "ルイ",
          "color": "#e8eef4",
          "initial": "ル",
          "role": "新入り（あなた）"
        },
        "mio": {
          "name": "ミオ",
          "color": "#ffb36b",
          "initial": "ミ",
          "role": "七号機の機長"
        },
        "ren": {
          "name": "レン",
          "color": "#6fd8ea",
          "initial": "レ",
          "role": "地上班の班長"
        },
        "genji": {
          "name": "ゲンジ",
          "color": "#ffd25a",
          "initial": "ゲ",
          "role": "整備士・翼の砲手"
        },
        "haru": {
          "name": "ハル",
          "color": "#b9a3ff",
          "initial": "ハ",
          "role": "本社の通信「タワー」"
        },
        "kagami": {
          "name": "カガミ",
          "color": "#c8d4e0",
          "initial": "カ",
          "role": "ヴェールの指揮官"
        },
        "veil": {
          "name": "ヴェール兵",
          "color": "#5a6070",
          "initial": "ヴ",
          "role": "鏡のバイザーの兵"
        },
        "civ": {
          "name": "市民",
          "color": "#9ad07a",
          "initial": "市",
          "role": ""
        }
      },
      "world": {
        "home": "midtown",
        "cities": [
          {
            "id": "midtown",
            "level": "midtown",
            "name": "ミッドタウン",
            "country": "アメリカ",
            "en": "Midtown",
            "map": [
              0.27,
              0.4
            ],
            "unlock": [],
            "needs": 1
          },
          {
            "id": "manhattan",
            "level": "manhattan",
            "name": "ニューヨーク",
            "country": "アメリカ",
            "en": "New York",
            "map": [
              0.29,
              0.43
            ],
            "unlock": [
              "c8"
            ],
            "needs": 2,
            "travel": {
              "from": "midtown",
              "sec": 8,
              "caption": "七号機、南へ。"
            }
          }
        ]
      },
      "chapters": [
        {
          "id": "p0",
          "city": "midtown",
          "level": "midtown",
          "needs": 1,
          "file": "story/chapters/p0.json",
          "title": "序章　スカイハイ陥落",
          "en": "The Fall",
          "caption": "封鎖 1 日目　17:05"
        },
        {
          "id": "c1",
          "city": "midtown",
          "level": "midtown",
          "needs": 1,
          "file": "story/chapters/c1.json",
          "lazy": true,
          "title": "第1章　黄昏便",
          "en": "Dusk Run",
          "caption": "封鎖 2 日目　17:40"
        },
        {
          "id": "c2",
          "city": "midtown",
          "level": "midtown",
          "needs": 1,
          "file": "story/chapters/c2.json",
          "lazy": true,
          "title": "第2章　図書館の灯",
          "en": "Library Lights",
          "caption": "封鎖 3 日目　17:48"
        },
        {
          "id": "c3",
          "draft": true,
          "release": 17,
          "city": "midtown",
          "level": "midtown",
          "needs": 2,
          "file": "story/chapters/c3.json",
          "lazy": true,
          "title": "第3章　スクリーンの声",
          "en": "Voice on the Screens",
          "caption": "封鎖 4 日目　17:30"
        },
        {
          "id": "c4",
          "draft": true,
          "release": 17,
          "city": "midtown",
          "level": "midtown",
          "needs": 2,
          "file": "story/chapters/c4.json",
          "lazy": true,
          "title": "第4章　ふたつの声",
          "en": "Two Voices",
          "caption": "封鎖 5 日目　18:10"
        },
        {
          "id": "c5",
          "draft": true,
          "release": 17,
          "city": "midtown",
          "level": "midtown",
          "needs": 2,
          "file": "story/chapters/c5.json",
          "lazy": true,
          "title": "第5章　甲板の夕焼け",
          "en": "Sunset Deck",
          "caption": "封鎖 6 日目　18:00"
        }
      ],
      "hub": {
        "lounge": [
          [
            "mio",
            "七号機は夕暮れにだけ飛ぶ。\n鏡の機体が空に溶けるから"
          ],
          [
            "genji",
            "今夜もカレーだ。文句は受け付けない"
          ],
          [
            "ren",
            "新入り。銃の手入れは済ませたか"
          ]
        ],
        "bunk": "新入り"
      }
    }
  }
};
