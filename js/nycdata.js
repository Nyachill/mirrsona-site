// 「本物のニューヨーク」のデータ（assets/levels/nyc/）の読み取り。THREE にも DOM にも依存しない（citygen.js と同じ UMD）。
//   ブラウザ: <script> で読む → MR.NycData      Node / Worker: require('../www/js/nycdata.js') → NycData（globalThis.MR.NycData にも入る）
//   作り方: tools/nyc/fetch_overture.py → tools/nyc/build_nyc.py（tools/nyc/README.md）。citygen_nyc.js（MR.CityGenNyc）が使う
//
// ■ 座標: 単位 m、+Y 上、+X = 格子の東（イースト川の方）、−Z = 格子の北（アベニューを北へ）。原点 = パーク街の中心線 × 42 丁目の中心線。
//   マンハッタンの格子が軸にそろうように、真北から GRID_ROTATION（約 29.0°）回してある（nyc.json の frame）。
//   世界 bounds（x −2900..3100, z −3000..9800）。タイル = 512 m 四方。tx = floor((x − minX) / 512), tz = floor((z − minZ) / 512)。
//   ファイル assets/levels/nyc/t_<tx>_<tz>.bin（nyc.json の隣。hd / sd 共通。陸も建物も無いタイルはファイルが無い = 全部水）。
//   nyc.json の tiles["tx_tz"] にバイト数と件数（tileColumns の順）、tileFile にファイル名の形、tileVersion に版。
//
// ■ タイルの持ち主: 建物（と部品）は外形の重心があるタイル。道・線・面はタイルの境で切ってある（隣と端点を共有する）。
//   → 建物だけはタイルの外へはみ出す（最大でも数百 m。座標は ±1024 m まで表せる）。
//
// ■ バイナリ（リトルエンディアン。セクションと列はすべて 4 バイト境界）
//   header 24 B: u32 magic 0x5443594E ('NYCT') | u16 version(1) | u16 nSections | i16 tx | i16 tz | f32 cx | f32 cz（タイル中心）| f32 scale（1/32 m）
//   section table: nSections × { char[4] tag, u32 offset（ファイル先頭から）, u32 byteLength }
//   座標は i16（タイル中心からの scale 単位）。デコードでワールド座標の Float32Array（x, z の交互）にする。
//   多角形ブロック: u32 nFeat, nRings, nVerts | u32 ringStart[nFeat+1] | u32 vertStart[nRings+1] | i16 xz[2·nVerts]
//     1 つ目のリングが外周（符号付き面積 ½Σ(x_i z_{i+1} − x_{i+1} z_i) > 0）、残りが穴（< 0）。閉じる頂点（最初と同じ点）は持たない。
//   線ブロック: u32 n, nVerts | u32 vertStart[n+1] | i16 xz[2·nVerts] | (ROAD のみ) i16 y[nVerts]（cm）
//   STRS: u32 n | u32 off[n+1] | utf-8 バイト列。0 番は ''（名前なし）
//   BLDG: 多角形ブロック + u32 gid | u16 height（dm、屋根の頂上）| u16 minHeight（dm、下端。宙に浮く建物・キャノピー）| u16 roofHeight（dm、
//         屋根の形の部分）| u16 name | u32 partStart[n+1]（PART の範囲）| u32 facadeColor | u32 roofColor（0x1RRGGBB、0 = 不明）|
//         u16 flags（buildingFlags）| u8 floors | u8 cls | u8 style | u8 roofShape | u8 facadeMat | u8 roofMat（enums）
//   PART: 多角形ブロック + u16 parent（このタイルの BLDG の番号）| u16 height | u16 minHeight | u16 roofHeight（dm）| u16 name |
//         u32 facadeColor | u32 roofColor | u8 roofShape | u8 facadeMat | u8 roofMat | u8 estimated（partFlags のビット: 1 = 高さが推定、
//         2 = remainder = 外形から部品を引いた残りを build_nyc.py が足したもの）
//         部品がある建物（flags & hasParts）は部品だけで形を作る。部品が外形を覆っていなかった所は remainder 部品で埋めてあるので
//         穴は空かない（flags & remainder）。外形の height は「その敷地に実際に立っているもの」の包絡（地面から積み上がる部品と
//         remainder の最大。他の建物の張り出しのように宙に浮いた部品は含めない）で、当たり判定・遠景用。
//         同じ建物の部品は「下端と上端が 0.5 m 以内」で重なることは無い（同じ高さの角柱が二重にならない。build_nyc.py の dedupe_parts、
//         tools/nyc/check.js の intraParts）。高さの範囲が入れ子の部品（上端が同じ・下端が同じ）も重ならない（内側の方が切ってある。
//         地面から立つ段は「0〜200 m の塔」と「塔の形を抜いた 0〜100 m の低層部」のように分かれていて、面が重ならない）
//         buildingFlags（nyc.json）: hasParts 1, heightEstimated 2, landmark 4, ml 8, courtyard 16, elevated 32, minEstimated 64, multi 128,
//         remainder 256, override 512（tools/nyc/overrides.json で直した）, underConstruction 1024（工事中。高さは今の高さに抑えてある）,
//         floorsEstimated 2048（floors はデータでなく高さから数えた値: データに階数が無い、または高さに比べてありえない階数だった）
//   ROAD: 線ブロック（y 付き。橋・高架の路面の高さ。地上は 0）+ u8 cls | u8 flags（roadFlags）| i8 level | u8 pad |
//         u8 curbL | u8 curbR（中心線から左右の縁石まで、0.1 m 単位）| u8 swL | u8 swR（歩道の幅、0.1 m）| u16 name
//         左右は線の向き（頂点の順）に対して。左 = 進行方向の左（x 右・z 下の画面で見て反時計回り側 = 法線 (−dz, dx)）。
//         車道・路地の幅は建物の壁・地図の歩道の線・並行する反対車線から測った値（無ければ種類ごとの既定値）
//   AREA: 多角形ブロック + u8 kind（areaKind。land = 陸。陸でない所は水面）| u8 sub（kind が water のとき waterKind）| u16 name | i16 y（cm）
//   LINE: 線ブロック（y なし）+ u8 kind（lineKind）| u16 name
//   PNTS: u32 n | i16 xz[2n] | u8 kind（pointKind）| u16 name（版 1 だけ。版 2 は CPRP）
//
// ■ タイル 版 2（nyc.json tileVersion 2。上の版 1 との違い）: 建物はチャンク（128 m。タイルと原点を共有し、1 タイル = 4 x 4 チャンク）ごとに
//   前もって切ってある（はみ出さない）。BLDG / PART / PNTS は無く、代わりに:
//   BLD2: u32 n | u32 gid | u16 height | u16 minHeight | u16 roofHeight（dm）| u16 name | u16 flags（buildingFlags）| u8 floors | u8 cls |
//         u8 style | u8 nParts（建物ごとの列。形は CPRS と core の PRT）
//   チャンク行の多角形ブロック（CPRS / CBLK）: u32 n, nRings, nVerts, nTri, triBytes(1|2), idBytes(0|2|4) | u32 rowStart[17]（チャンク
//         k = lz·4 + lx の行は rowStart[k]..rowStart[k+1]。lx = cx − 4·tx）| u8 ringCount[n] | u16 vertCount[nRings] |
//         i16 xz[2·nVerts]（リングの 1 つ目の頂点はタイル中心から、2 つ目からは 1 つ前の頂点からの差。scale 単位）|
//         u8 clip[ceil(nVerts / 8)]（頂点 v のビット = 辺 v → 次の頂点 がチャンクの切り口: 描かない・壁にしない）| <各セクションの列> |
//         u16 triCount[n] | u8|u16 tri[nTri]（屋根 / 上面の三角形。行の頂点（外周、穴の順）の番号、反時計回り。0 個 = 下の flags）
//   CPRS（建物の角柱）: 列 = piece（idBytes: core の PRT の番号。高さ・色・材質はそこ）| u8 flags: 1 rect（軸にそろった長方形 = k 0 の箱。
//         10 cm 以内で外接矩形にそろえてある）, 2 convex（扇形でよい）, 4 clipped（切り口の辺がある）, 8 remainder, 16 高さが推定,
//         32 entRemainder（入れる建物 ENTB の長方形の外に残った部分。ENTB の部品そのものはここに無い = genEnterable が作る）,
//         64 noTri（三角形が無い: 自分で分割する）, 128 part（部品。0 = 外形）
//   CBLK（歩道・広場などの台: 高さ y の箱で上面を歩く）: 列 = u8 kind（0 歩道 = 街区（陸 − 車道）、1 広場（pedestrian / plaza の面）、
//         2 中央分離帯、3 交通島）| u8 flags（2 convex, 64 noTri）| i16 y（cm。上面の高さ）
//   CDEC（路面の印）: u32 n | u32 rowStart[17] | i16 seg[4n]（x0, z0, x1, z1。タイル中心から）| u8 kind（0 中央線（黄 2 本）0.35 m、
//         1 車線の破線 0.12 m、2 横断歩道 3.0 m = DECAL_WIDTH。線分を中心に幅の帯）
//   CPRP（小物）: u32 nP | u32 rowStart[17] | i16 xz[2nP] | u8 kind（enums.pointKind）| u8 yaw（256 = 1 周。車道の方。0 = 向きなし）|
//         u32 nF | u32 rowStartF[17] | i16 seg[4nF] | u8 kind（enums.lineKind）| u8 h（dm）| u8 t（cm）（柵・塀を薄い箱に）
//         出現地点（core の SPWN）から 2 m 以内の小物は入れていない
//   ENTB（入れる建物。行は長方形の中心のチャンクごと）: u32 n | u32 rowStart[17] | 下の core の ENTB と同じ列
//   CPAT（描画だけの片の属性。core の PRT から移した）: u32 n | u8 cls | u8 roofShape | u8 facadeMat | u8 roofMat | u16 roofHeight（dm）|
//         u32 facadeColor | u32 roofColor（0x1RRGGBB、0 = 不明）。行 k の片 = このタイルの CPRS と ENTB の行の片を番号の順に重ねずに並べた k 番目
//         （片の列はファイルに無い。decodeTile が作る → t.pieceAttrs.piece）。片をまたぐタイルでは同じ値がどのタイルにもある。
//         建物ごとの属性（名前・階数・flags・様式）は BLD2（gid）、高さ・dev・様式・階数は core の PRT
//   RAIL（線路。nyc-complete NC1。tools/nyc/nycrail.py）: 線ブロック（y 付き = レールの上面の高さ、cm）+ u8 cls（roadClass: rail / subway /
//         light_rail …）| u8 flags（railFlags: 1 bridge, 2 tunnel, 4 ramp（トンネルの入口の坂・橋の上の入口から地面までの坂）, 8 disused,
//         16 abandoned, 32 elevated（高架・高架橋 = el。大きな橋の外で 1 m より上がる橋・高架の片。bridge の bit は外してある）, 64 covered,
//         128 corridor（大きな橋の路面の高さの形に乗る。bridge も立つ）。bridge だけ = 低い・短い橋）| i8 level | u16 name（路線名）|
//         u8 group（このタイルで並ぶ線路のまとまり 1..255。トンネルと地上は別。0 = 入りきらなかった）。トンネルも全部（地上 0、高架・橋は
//         level 1 = 9 m + 上の level ごとに 5 m（場所ごとの表あり。大きな橋は路面の形）、トンネルは level × 8 m 下（6 m 以上）でトンネルの入口から
//         3.5 % で下る）。地図の外は切ってある
//         （端点が bounds の上 = 地図の端）。ROAD の rail の行（地上・橋だけ、古い高さ）は今まで通り残してある
//   RPRT（トンネルの入口。行は口のあるタイル）: u32 n | i16 xz[2n]（タイル中心から scale 単位）| u16 yaw（65536 = 1 周。トンネルの中へ向く
//         向き = (sin yaw, cos yaw)）| u16 width（dm、並ぶ線路の幅 + 4.5 m）| i16 y（cm、口の高さ = 地面）| u16 name | u8 cls | u8 tracks |
//         u8 flags（portalFlags: 1 aboveGrade = 地面より上でトンネルにつながっていた（マンハッタン橋）: 口はトンネルが地面まで下りた所。
//         その手前の坂（RAIL の ramp）に構造が要る = NC3）
//   STAT（地下鉄の駅。nyc-complete NC4。tools/nyc/nycstation.py。行 = 駅の中心のあるタイルの駅。形は core の STAT、ここは名前と MTA の記録）:
//         u32 n | u16 core[n]（core の STAT の駅の番号）| u16 nameEn | u16 nameJa | u16 routes（STRS。"1 2 3 7 N Q R W S"）| u32 mta（MTA の
//         complex_id、0 = PATH）| u8 struct（0 '', 1 Subway, 2 Elevated, 3 Viaduct, 4 At Grade, 5 Open Cut, 6 Embankment, 7 PATH）| u8 pad |
//         u32 nE | u32 entStart[n+1] | i32 xz[2nE]（dm、ワールド。MTA の点 / 作った入口の元の点）| u8 kind（下の core の kind。
//         0x40 = 置いていない: 建物の中の入口（Easement / Station House、下位 4 ビット 5〜7）か、置けなかった道の入口（0〜4））| u8 flags（1 入れる、2 出られる）| u16 coreEnt（core の入口の番号、
//         0xFFFF = 置いていない）| u16 gtfs（STRS）| u32 nP | u32 platStart[n+1] | u16 corePlat | u16 trackPos | u16 trackNeg（STRS、
//         ホームの + 側 / − 側の線路の路線名）
//   予約したタグ（まだ書かない。知らないセクションは飛ばすので、足しても古い読み手は壊れない。plan nyc-cinematic §5.2 / §13）:
//     CPRF  片ごとのファサードの記録（CPAT と同じ並び = このタイルの片の番号の順）: fam | era | use | storey（dm）| bay（dm）| win（%）|
//           bands（下位 4 ビット 1 階側の階数、上位 4 ビット 上の階数）| tint | age | roofMat | roofTint | flags | u16 gidTop（建物の上端、dm）
//     CEDG  壁の辺ごとの u8 ビット（CPRS の頂点の順 = 辺 v → 次の頂点。clip の辺も 1 つ数える）: 1 露出 / 0 境界壁, 2 店先, 4 非常階段の面,
//           8 小屋, 16 入口
//     CRFP 屋上の小物（給水塔 {x, z, r, h} …）| CTRE 木と公園の樹冠 | CBBD 看板の四角 | CAOC 壁の辺ごとの AO（u8 × 4）|
//     CGAO 地面の AO（4 m の R8）| LANE / SIGN / PFLW（車線・標識・歩行者の流れ。life.md §4.1）
//     版を上げずに足せるのは「新しいセクション」だけ。既存のセクションの列を変えるときはタイルの版（header の version）を上げる
//
// ■ core.bin（'NYCC' 版 2。nyc.json の core.file。リトルエンディアン、4 バイト境界。タイルが無くても使えるゲームの形: サーバー・当たり判定の外側・
//   遠景・地図・出現地点。予算 ≤ 3.5 MB / gzip ≤ 1.5 MB（Worker のバンドル。tools/nyc/checkv2.js が失敗にする））
//   header 32 B: u32 magic 0x4343594E | u16 version(2) | u16 nSections | i32 minX, minZ, maxX, maxZ（m）| u16 chunk(128) | u16 tile(512) |
//   u16 ncx | u16 ncz、続いてタイルと同じセクション表。
//   vcount: u32 nBytes | 符号なし LEB128 の個数（リング数・頂点数。→ 始まりの位置）
//   vxz: u32 nBytes | zigzag LEB128 の座標の差（x, z の順）。リング / 線 / 点の 1 つ目の頂点は 1 つ前のリング（線・点）の 1 つ目からの差
//        （最初は (0, 0) から）、ほかは 1 つ前の頂点からの差。単位はセクションごと（dm = 0.1 m の世界座標、cm、(minX, minZ) からの unit m）
//   多角形ブロック: u32 n, nRings, nVerts | vcount ringCount[n] | vcount vertCount[nRings] | vxz（外周が先 = 正の面積、穴は負）
//   LAND: 多角形ブロック（dm）= 陸 ∪ 桟橋（1 m で単純化）。偶奇の規則で中 = 陸（y 0）、外 = 水
//   LGRD: u32 cell(4), W, H, nRuns | u32 rowStart[H+1] | u16 run[nRuns]（値 << 14 | 長さ。値 0 水, 1 陸, 2 混ざり）| u32 nMixed |
//         u8 mixedRuns[nMixed]（混ざりのセルを行の順に。その辺の連なりの数）| u32 nEdgeRuns | u32 edge[nEdgeRuns]（LAND の頂点番号 =
//         辺の始点）| u8 len[nEdgeRuns]（同じリングの続いた辺の数）。混ざりのセルの点は +x へ純粋なセルまで交差を数える（isLand）
//   WATR: 多角形ブロック（dm）+ i16 y（cm、水面）| i16 bed（cm、底）| u8 sub（waterKind）: 湖・池・貯水池・噴水・プール
//   PARK: u32 unitMm(500) | 多角形ブロック（(minX, minZ) から 0.5 m）+ u8 kind（areaKind）: 公園・芝・広場・浜など（2 m で単純化）
//   RDS: u32 n, nVerts | vcount vertCount[n] | vxz（(minX, minZ) から 0.25 m）| i16 y[nVerts]（cm）| u8 cls | u8 flags（roadFlags）|
//         u8 curbL, curbR, swL, swR（0.1 m）: 車の通る道（トンネル以外）
//   DECK: u32 n, nVerts | vcount vertCount[n] | vxz（cm）| i16 y[nV]（cm）| u32 chain | u16 seq | u8 kind（0 四角、1 平らでない四角を
//         割った三角、2 曲がりの外のベベル三角）| u8 cls | u32 rds（RDS の番号、0xFFFFFFFF = 歩道など）。橋・高架の路面。続いた片は頂点を
//         共有（マイター、限界 4）。厚さ DECK_THICKNESS 1.2 m（上面から下へ）。平面 plane[3n]（y = a·x + b·z + c）は読むときに cm の頂点から
//         最小二乗で作る（tools/nyc/nycv2geo.py の plane_of と同じ）
//   PRT（建物の片 = 部品か外形。gid 順）: u32 n, nRings, nVerts, supCell(32) | f32 supPad(0.5) | vcount ringCount[n] | vcount vertCount[nRings] |
//         vxz（E リング、dm の世界座標）| u32 gid0 | u8 gidDelta[n] | u16 y0（dm、切り上げ）| u16 y1（dm、切り捨て。切り上げ = + flags 64）|
//         u8 dev（dm、E と本当の形 R のハウスドルフ距離の切り上げ）| u8 style | u8 floors | u8 flags（1 part, 2 remainder, 4 推定, 8 ENTB,
//         16 rect, 32 devSat（solid を作らない）, 64 y1 切り上げ）
//         E は Douglas–Peucker 0.5 m（リングごと 32 頂点以下になるまで増やす）。支え = E を dev + 0.5 m 外へ（上限）、固い箱 = dev + 0.25 m 内へ（下限）
//         描画だけの列（cls・roofShape・材質・色・roofHeight）はタイルの CPAT。
//         読むときに作るもの（pieceIndex）: pieces.bbox（E の外周の外接矩形）、pieces.chunkStart / chunkPieces（チャンク cz·ncx + cx →
//         E ⊕ dev の外接矩形が重なる片）、core.supi = { cell, W, H, pad, start, piece }（supCell m のセル → E ⊕ (dev + supPad) の外接矩形が
//         触れる片。版 1 の SUPI セクションと同じ中身）
//   ENTB: u32 n | u32 piece | i16 x0, z0, x1, z1（整数 m、ワールド）| u8 floors | u8 fh（0.05 m 単位）| u8 front（0 N, 1 E, 2 S, 3 W）| u8 exp（SIDE_BIT:
//         n 1, s 2, w 4, e 8 = 窓・扉を付けてよい面）
//   MASS: u32 nChunks | u16 count[nChunks] | u32 unitMm(500) | 多角形ブロック（(minX, minZ) から 0.5 m）| u16 h（dm、低い建物の面積の
//         重み付き平均）| u8 cover（255 = 全部）
//   HPAD: u32 n | i32 xz[2n]（dm）| u16 y（dm、屋上なら屋根）| u16 r（dm）| u8 roof | u8 heliport
//   SPWN: u32 n | vxz（(minX, minZ) から 0.25 m。点を順に）| u8 zone（nyc.json hotZones の番号、255 = 外）| u8 mask（1 solo, 2 online, 4 royale の地上）
//   HERO: u32 n（0。R2 で埋める）
//   RLEL（nyc-complete NC3。tools/nyc/nycrail.py rlel_section。古い読み手は知らないセクションを飛ばす）: 高架・トンネルの口・高架の駅のホーム。
//         u32 nL, nV | vcount vertCount[nL] | vxz（dm、ワールド）| i16 y[nV]（cm、レールの上面）| u8 cls[nL]（roadClass）| u8 flags[nL]（railFlags）|
//         u32 nP | i32 xz[2nP]（dm）| u16 yaw（65536 = 1 周、トンネルの中へ）| u16 width（dm）| i16 y（cm）| u8 flags（portalFlags）| u8 tracks |
//         u32 nF | vcount vertCount[nF]（4 角）| vxz（dm）| i16 y[nF]（cm、ホームの上面）。
//         線 = 地上の線路とトンネルの坂のうちレールが 0.3 m 以上の所（地図で切る）+ その 20 m 以内の地上の線路（y < 0.3: 柱をよける所だけ）。
//         ゲームの層（citygen_nyc.js _initEl）がここから el の床・柱・梁・ホーム・口の掘割とトンネルを作る（サーバーも同じ）→ core.rlel = { lines, portals, plats }
//   STAT（nyc-complete NC4。tools/nyc/nycstation.py stat_section。古い読み手は飛ばす）: 地下鉄の駅（MTA の駅 + PATH）・ホーム・道の入口。サーバーの入力。
//         u32 nC | vxz（dm、駅の中心。点を順に）| u8 depth（0 浅い、1 深い（tools/nyc/stations.json）、2 高架、3 地上）| u8 flags（1 MTA、2 PATH、
//         4 入口を作った = MTA の入口が置けなかった）| i16 mezz（cm、改札階の床。−32768 = 無い）| vcount nEnt[nC] | vcount nPlat[nC] |
//         u32 nE | vxz（dm、入口の中心）| u8 yaw（256 = 1 周、下りる向き (sin, cos)）| u8 w | u8 l（dm、手すりの外の幅・長さ。長さは yaw の向き）|
//         u8 kind（下位 4 ビット 0 階段、1 階段 + エスカレーター、2 エスカレーター、3 エレベーター、4 坂。0x10 作った、0x20 MTA の点からずらした）|
//         u32 nP | vxz（dm、ホームの中心）| u16 yaw（65536 = 1 周、ホームの軸 (sin, cos)）| u16 hl（0.05 m、半分の長さ）| u8 hw（0.05 m、半分の幅）|
//         i16 y（cm、ホームの上面 = 横の線路のレールの上面 + 1 m）| u8 flags（1 + 側に線路、2 − 側に線路（両方 = 島式）、4 トンネル、8 高架、16 地上、
//         32 深い）。+ 側 = 軸 (ux, uz) を (uz, −ux) に回した向き。ホームの線路側の縁は線路の中心から 1.6 m。
//         → core.stat = { count, xz, depth, flags, mezz, entStart, platStart, ents: { count, xz, yaw, w, l, kind }, plats: { count, xz, yaw, hl, hw, y, flags } }
//
// ■ API
//   NycData.decodeTile(buffer)                ArrayBuffer か Uint8Array → { version, tx, tz, cx, cz, strings, buildings, parts, roads, areas, lines, points,
//                                            prisms, plinths, decals, props, fences, entb, pieceAttrs, rails, portals, stations }（版 1 では版 2 のもの = null、版 2 では parts / points は空、
//                                            buildings は BLD2 の列だけ（形なし。slim: true））。各ブロックは列ごとの型付き配列、xz はワールド座標（m）
//   NycData.decodeCore(buffer)               → core（上の各セクション。core.grid = LGRD を広げた Uint8Array(W·H)）。core.isLand(x, z) / landCell(x, z)
//   NycData.chunkRows(block, tile, cx, cz)    → [a, b)（版 2 のチャンク行の範囲）  NycData.pieceY(core, i) → { y0, y1f, y1c, dev }（m）
//   NycData.pieceAttr(tile, piece)            → タイルの pieceAttrs（CPAT）の行番号（無ければ −1）
//   NycData.tileKey(tx, tz) / tileOf(meta, x, z) → [tx, tz] / tileRect(meta, tx, tz) → [x0, z0, x1, z1] / tileUrl(meta, tx, tz) / hasTile(meta, tx, tz)
//   NycData.tilesInRect(meta, x0, z0, x1, z1) → [[tx, tz], …]（ファイルがあるものだけ）
//   NycData.ring(block, ringIndex) → Float32Array [x0, z0, x1, z1, …]（コピー）  NycData.rings(block, feature) → [ringIndex…]
//   NycData.building(tile, i) / part(tile, i) / road(tile, i) / area(tile, i)  → ふつうのオブジェクト（デバッグ・ツール用。遅い）
//   NycData.enumName(meta, 'roadClass', code) / enumCode(meta, 'areaKind', 'park')
//   NycData.signedArea(xz, a, b) … 頂点 a..b（含まない）の符号付き面積
//   NycData.pointIn(block, i, x, z) … 点が多角形ブロック（buildings / parts / areas）の i 番の中か（穴は外）
(function (root) {
  const MR = root.MR || (root.MR = {});
  const MAGIC = 0x5443594e;

  function Reader(buf, off) {
    this.buf = buf;
    this.dv = new DataView(buf);
    this.p = off;
  }
  Reader.prototype.u32 = function () { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; };
  Reader.prototype._align = function () { this.p = (this.p + 3) & ~3; };
  Reader.prototype.arr = function (Type, n) {
    const a = new Type(this.buf, this.p, n);
    this.p += n * Type.BYTES_PER_ELEMENT;
    this._align();
    return a;
  };

  function polyBlock(r, cx, cz, scale) {
    const n = r.u32(), nRings = r.u32(), nVerts = r.u32();
    const ringStart = r.arr(Uint32Array, n + 1);
    const vertStart = r.arr(Uint32Array, nRings + 1);
    const q = r.arr(Int16Array, nVerts * 2);
    const xz = new Float32Array(nVerts * 2);
    for (let i = 0; i < nVerts * 2; i += 2) { xz[i] = cx + q[i] * scale; xz[i + 1] = cz + q[i + 1] * scale; }
    return { count: n, ringStart, vertStart, xz };
  }

  function lineBlock(r, cx, cz, scale, withY) {
    const n = r.u32(), nVerts = r.u32();
    const vertStart = r.arr(Uint32Array, n + 1);
    const q = r.arr(Int16Array, nVerts * 2);
    const xz = new Float32Array(nVerts * 2);
    for (let i = 0; i < nVerts * 2; i += 2) { xz[i] = cx + q[i] * scale; xz[i + 1] = cz + q[i + 1] * scale; }
    const out = { count: n, vertStart, xz };
    if (withY) {
      const yq = r.arr(Int16Array, nVerts);
      const y = new Float32Array(nVerts);
      for (let i = 0; i < nVerts; i++) y[i] = yq[i] * 0.01;
      out.y = y;
    }
    return out;
  }

  function scaled(src, k) {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] * k;
    return out;
  }

  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8(bytes) {
    if (td) return td.decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  const SECTIONS = {
    STRS(r, t) {
      const n = r.u32();
      const off = r.arr(Uint32Array, n + 1);
      const bytes = new Uint8Array(r.buf, r.p, off[n]);
      const s = new Array(n);
      for (let i = 0; i < n; i++) s[i] = i === 0 ? '' : utf8(bytes.subarray(off[i], off[i + 1]));
      t.strings = s;
    },
    BLDG(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.gid = r.arr(Uint32Array, n);
      b.height = scaled(r.arr(Uint16Array, n), 0.1);
      b.minHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.roofHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      b.partStart = r.arr(Uint32Array, n + 1);
      b.facadeColor = r.arr(Uint32Array, n);
      b.roofColor = r.arr(Uint32Array, n);
      b.flags = r.arr(Uint16Array, n);
      b.floors = r.arr(Uint8Array, n);
      b.cls = r.arr(Uint8Array, n);
      b.style = r.arr(Uint8Array, n);
      b.roofShape = r.arr(Uint8Array, n);
      b.facadeMat = r.arr(Uint8Array, n);
      b.roofMat = r.arr(Uint8Array, n);
      t.buildings = b;
    },
    PART(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.parent = r.arr(Uint16Array, n);
      b.height = scaled(r.arr(Uint16Array, n), 0.1);
      b.minHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.roofHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      b.facadeColor = r.arr(Uint32Array, n);
      b.roofColor = r.arr(Uint32Array, n);
      b.roofShape = r.arr(Uint8Array, n);
      b.facadeMat = r.arr(Uint8Array, n);
      b.roofMat = r.arr(Uint8Array, n);
      b.estimated = r.arr(Uint8Array, n);
      t.parts = b;
    },
    ROAD(r, t) {
      const b = lineBlock(r, t.cx, t.cz, t.scale, true);
      const n = b.count;
      b.cls = r.arr(Uint8Array, n);
      b.flags = r.arr(Uint8Array, n);
      b.level = r.arr(Int8Array, n);
      r.arr(Uint8Array, n); // pad
      b.curbL = scaled(r.arr(Uint8Array, n), 0.1);
      b.curbR = scaled(r.arr(Uint8Array, n), 0.1);
      b.swL = scaled(r.arr(Uint8Array, n), 0.1);
      b.swR = scaled(r.arr(Uint8Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      t.roads = b;
    },
    AREA(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.kind = r.arr(Uint8Array, n);
      b.sub = r.arr(Uint8Array, n);
      b.name = r.arr(Uint16Array, n);
      b.y = scaled(r.arr(Int16Array, n), 0.01);
      t.areas = b;
    },
    LINE(r, t) {
      const b = lineBlock(r, t.cx, t.cz, t.scale, false);
      b.kind = r.arr(Uint8Array, b.count);
      b.name = r.arr(Uint16Array, b.count);
      t.lines = b;
    },
    PNTS(r, t) {
      const n = r.u32();
      const q = r.arr(Int16Array, n * 2);
      const xz = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i += 2) { xz[i] = t.cx + q[i] * t.scale; xz[i + 1] = t.cz + q[i + 1] * t.scale; }
      t.points = { count: n, xz, kind: r.arr(Uint8Array, n), name: r.arr(Uint16Array, n) };
    },
    // ---------- 版 2 ----------
    BLD2(r, t) {
      const n = r.u32();
      const b = EMPTY_POLY(n);
      b.gid = r.arr(Uint32Array, n);
      b.height = scaled(r.arr(Uint16Array, n), 0.1);
      b.minHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.roofHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      b.flags = r.arr(Uint16Array, n);
      b.floors = r.arr(Uint8Array, n);
      b.cls = r.arr(Uint8Array, n);
      b.style = r.arr(Uint8Array, n);
      b.nParts = r.arr(Uint8Array, n);
      b.partStart = new Uint32Array(n + 1);
      b.slim = true;
      t.buildings = b;
    },
    CPRS(r, t) {
      const b = rowPolys(r, t);
      b.piece = b.idBytes === 2 ? r.arr(Uint16Array, b.count) : r.arr(Uint32Array, b.count);
      b.flags = r.arr(Uint8Array, b.count);
      rowTris(r, b);
      t.prisms = b;
    },
    CBLK(r, t) {
      const b = rowPolys(r, t);
      b.kind = r.arr(Uint8Array, b.count);
      b.flags = r.arr(Uint8Array, b.count);
      b.y = scaled(r.arr(Int16Array, b.count), 0.01);
      rowTris(r, b);
      t.plinths = b;
    },
    CDEC(r, t) {
      const n = r.u32();
      const rowStart = r.arr(Uint32Array, 17);
      t.decals = { count: n, rowStart, seg: segs(r.arr(Int16Array, n * 4), t), kind: r.arr(Uint8Array, n) };
    },
    CPRP(r, t) {
      const n = r.u32();
      const rowStart = r.arr(Uint32Array, 17);
      const q = r.arr(Int16Array, n * 2);
      const xz = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i += 2) { xz[i] = t.cx + q[i] * t.scale; xz[i + 1] = t.cz + q[i + 1] * t.scale; }
      t.props = { count: n, rowStart, xz, kind: r.arr(Uint8Array, n), yaw: r.arr(Uint8Array, n) };
      const m = r.u32();
      const rs = r.arr(Uint32Array, 17);
      const seg = segs(r.arr(Int16Array, m * 4), t);
      t.fences = { count: m, rowStart: rs, seg, kind: r.arr(Uint8Array, m), h: scaled(r.arr(Uint8Array, m), 0.1), t: scaled(r.arr(Uint8Array, m), 0.01) };
    },
    ENTB(r, t) {
      const n = r.u32();
      const rowStart = r.arr(Uint32Array, 17);
      t.entb = entbCols(r, n);
      t.entb.rowStart = rowStart;
    },
    RAIL(r, t) {
      const b = lineBlock(r, t.cx, t.cz, t.scale, true);
      const n = b.count;
      b.cls = r.arr(Uint8Array, n);
      b.flags = r.arr(Uint8Array, n);
      b.level = r.arr(Int8Array, n);
      b.name = r.arr(Uint16Array, n);
      b.group = r.arr(Uint8Array, n);
      t.rails = b;
    },
    RPRT(r, t) {
      const n = r.u32();
      const q = r.arr(Int16Array, n * 2);
      const xz = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i += 2) { xz[i] = t.cx + q[i] * t.scale; xz[i + 1] = t.cz + q[i + 1] * t.scale; }
      const yq = r.arr(Uint16Array, n), wq = r.arr(Uint16Array, n), hq = r.arr(Int16Array, n);
      const yaw = new Float32Array(n), width = new Float32Array(n), y = new Float32Array(n);
      for (let i = 0; i < n; i++) { yaw[i] = yq[i] * (Math.PI * 2 / 65536); width[i] = wq[i] * 0.1; y[i] = hq[i] * 0.01; }
      t.portals = { count: n, xz, yaw, width, y, name: r.arr(Uint16Array, n), cls: r.arr(Uint8Array, n), tracks: r.arr(Uint8Array, n), flags: r.arr(Uint8Array, n) };
    },
    STAT(r, t) { // nyc-complete NC4: names and MTA records of the stations whose centre is in this tile (geometry in core STAT)
      const n = r.u32();
      const st = {
        count: n, core: r.arr(Uint16Array, n), nameEn: r.arr(Uint16Array, n), nameJa: r.arr(Uint16Array, n), routes: r.arr(Uint16Array, n),
        mta: r.arr(Uint32Array, n), struct: r.arr(Uint8Array, n)
      };
      r.arr(Uint8Array, n);
      const ne = r.u32();
      st.entStart = r.arr(Uint32Array, n + 1);
      const xz = scaled(r.arr(Int32Array, ne * 2), 0.1);
      st.ents = { count: ne, xz, kind: r.arr(Uint8Array, ne), flags: r.arr(Uint8Array, ne), core: r.arr(Uint16Array, ne), gtfs: r.arr(Uint16Array, ne) };
      const np = r.u32();
      st.platStart = r.arr(Uint32Array, n + 1);
      st.plats = { count: np, core: r.arr(Uint16Array, np), trackPos: r.arr(Uint16Array, np), trackNeg: r.arr(Uint16Array, np) };
      t.stations = st;
    },
    CPAT(r, t) { // after CPRS and ENTB (decodeTile defers it): the pieces are the sorted unique pieces of their rows
      const n = r.u32();
      const ids = new Set();
      if (t.prisms) for (let i = 0; i < t.prisms.count; i++) ids.add(t.prisms.piece[i]);
      if (t.entb) for (let i = 0; i < t.entb.count; i++) ids.add(t.entb.piece[i]);
      const piece = Uint32Array.from(ids).sort();
      if (piece.length !== n) throw new Error('NycData: CPAT has ' + n + ' rows for ' + piece.length + ' pieces');
      t.pieceAttrs = {
        count: n, piece, cls: r.arr(Uint8Array, n), roofShape: r.arr(Uint8Array, n), facadeMat: r.arr(Uint8Array, n),
        roofMat: r.arr(Uint8Array, n), roofHeight: scaled(r.arr(Uint16Array, n), 0.1),
        facadeColor: r.arr(Uint32Array, n), roofColor: r.arr(Uint32Array, n)
      };
    }
  };

  function segs(q, t) {
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 2) { out[i] = t.cx + q[i] * t.scale; out[i + 1] = t.cz + q[i + 1] * t.scale; }
    return out;
  }
  function entbCols(r, n) {
    const piece = r.arr(Uint32Array, n);
    const rect = r.arr(Int16Array, n * 4);
    const floors = r.arr(Uint8Array, n);
    const fq = r.arr(Uint8Array, n);
    const fh = new Float64Array(n);
    for (let i = 0; i < n; i++) fh[i] = fq[i] / 20; // = build_nyc's fh_q / 20 (canEnter must see the same number)
    return { count: n, piece, rect, floors, fh, front: r.arr(Uint8Array, n), exp: r.arr(Uint8Array, n) };
  }
  // 版 2 のチャンク行の多角形（差分の頂点を広げる）
  function rowPolys(r, t) {
    const n = r.u32(), nRings = r.u32(), nVerts = r.u32(), nTri = r.u32(), triBytes = r.u32(), idBytes = r.u32();
    const rowStart = r.arr(Uint32Array, 17);
    const ringCount = r.arr(Uint8Array, n);
    const vertCount = r.arr(Uint16Array, nRings);
    const q = r.arr(Int16Array, nVerts * 2);
    const clip = r.arr(Uint8Array, (nVerts + 7) >> 3);
    const ringStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) ringStart[i + 1] = ringStart[i] + ringCount[i];
    const vertStart = new Uint32Array(nRings + 1);
    for (let k = 0; k < nRings; k++) vertStart[k + 1] = vertStart[k] + vertCount[k];
    const xz = new Float32Array(nVerts * 2);
    const ox = Math.round(t.cx / t.scale), oz = Math.round(t.cz / t.scale), sc = t.scale;
    for (let k = 0; k < nRings; k++) {
      let ax = ox, az = oz;
      for (let v = vertStart[k]; v < vertStart[k + 1]; v++) { ax += q[v * 2]; az += q[v * 2 + 1]; xz[v * 2] = ax * sc; xz[v * 2 + 1] = az * sc; }
    }
    return { count: n, rowStart, ringStart, vertStart, xz, clip, nTri, triBytes, idBytes };
  }
  function rowTris(r, b) {
    const n = b.count;
    const triCount = r.arr(Uint16Array, n);
    b.tri = b.triBytes === 2 ? r.arr(Uint16Array, b.nTri) : r.arr(Uint8Array, b.nTri);
    b.triStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) b.triStart[i + 1] = b.triStart[i] + triCount[i];
  }

  const EMPTY_POLY = (n) => ({ count: n || 0, ringStart: new Uint32Array((n || 0) + 1), vertStart: new Uint32Array(1), xz: new Float32Array(0) });

  function decodeTile(input) {
    let buf;
    if (input instanceof ArrayBuffer) buf = input;
    else if (ArrayBuffer.isView(input)) {
      buf = (input.byteOffset % 4 === 0 && input.byteOffset === 0 && input.byteLength === input.buffer.byteLength)
        ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else throw new Error('NycData.decodeTile: ArrayBuffer expected');
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('NycData: not a NYC tile');
    const version = dv.getUint16(4, true);
    if (version !== 1 && version !== 2) throw new Error('NycData: unsupported tile version ' + version);
    const nSec = dv.getUint16(6, true);
    const t = {
      version, tx: dv.getInt16(8, true), tz: dv.getInt16(10, true),
      cx: dv.getFloat32(12, true), cz: dv.getFloat32(16, true), scale: dv.getFloat32(20, true),
      strings: [''], buildings: null, parts: null, roads: null, areas: null, lines: null, points: null,
      prisms: null, plinths: null, decals: null, props: null, fences: null, entb: null, pieceAttrs: null, rails: null, portals: null, stations: null,
      byteLength: buf.byteLength
    };
    const later = [];
    for (let i = 0; i < nSec; i++) {
      const o = 24 + i * 12;
      const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      const off = dv.getUint32(o + 4, true);
      const fn = SECTIONS[tag];
      if (tag === 'CPAT') { later.push([fn, off]); continue; } // CPRS と ENTB の後で
      if (fn) fn(new Reader(buf, off), t); // 知らないセクションは飛ばす（新しい版の追加分）
    }
    for (const [fn, off] of later) fn(new Reader(buf, off), t);
    if (!t.buildings) t.buildings = Object.assign(EMPTY_POLY(), { gid: new Uint32Array(0), partStart: new Uint32Array(1) });
    if (!t.parts) t.parts = EMPTY_POLY();
    if (!t.areas) t.areas = EMPTY_POLY();
    if (!t.roads) t.roads = { count: 0, vertStart: new Uint32Array(1), xz: new Float32Array(0), y: new Float32Array(0) };
    if (!t.lines) t.lines = { count: 0, vertStart: new Uint32Array(1), xz: new Float32Array(0) };
    if (!t.points) t.points = { count: 0, xz: new Float32Array(0), kind: new Uint8Array(0), name: new Uint16Array(0) };
    // 線路とトンネルの入口（NC1 より前のタイルには無い = 空）
    if (!t.rails) t.rails = { count: 0, vertStart: new Uint32Array(1), xz: new Float32Array(0), y: new Float32Array(0), cls: new Uint8Array(0), flags: new Uint8Array(0), level: new Int8Array(0), name: new Uint16Array(0), group: new Uint8Array(0) };
    if (!t.portals) t.portals = { count: 0, xz: new Float32Array(0), yaw: new Float32Array(0), width: new Float32Array(0), y: new Float32Array(0), name: new Uint16Array(0), cls: new Uint8Array(0), tracks: new Uint8Array(0), flags: new Uint8Array(0) };
    if (!t.stations) t.stations = { count: 0, core: new Uint16Array(0), nameEn: new Uint16Array(0), nameJa: new Uint16Array(0), routes: new Uint16Array(0), mta: new Uint32Array(0), struct: new Uint8Array(0), entStart: new Uint32Array(1), ents: { count: 0, xz: new Float32Array(0), kind: new Uint8Array(0), flags: new Uint8Array(0), core: new Uint16Array(0), gtfs: new Uint16Array(0) }, platStart: new Uint32Array(1), plats: { count: 0, core: new Uint16Array(0), trackPos: new Uint16Array(0), trackNeg: new Uint16Array(0) } };
    if (version >= 2) { // a tile without v2 content (water, a ferry line) has no v2 sections: empty blocks
      const rows = () => ({ count: 0, rowStart: new Uint32Array(17), ringStart: new Uint32Array(1), vertStart: new Uint32Array(1), xz: new Float32Array(0), clip: new Uint8Array(0), tri: new Uint8Array(0), triStart: new Uint32Array(1), flags: new Uint8Array(0) });
      if (!t.prisms) t.prisms = Object.assign(rows(), { piece: new Uint32Array(0) });
      if (!t.plinths) t.plinths = Object.assign(rows(), { kind: new Uint8Array(0), y: new Float32Array(0) });
      if (!t.decals) t.decals = { count: 0, rowStart: new Uint32Array(17), seg: new Float32Array(0), kind: new Uint8Array(0) };
      if (!t.props) t.props = { count: 0, rowStart: new Uint32Array(17), xz: new Float32Array(0), kind: new Uint8Array(0), yaw: new Uint8Array(0) };
      if (!t.fences) t.fences = { count: 0, rowStart: new Uint32Array(17), seg: new Float32Array(0), kind: new Uint8Array(0), h: new Float32Array(0), t: new Float32Array(0) };
      if (!t.entb) t.entb = { count: 0, rowStart: new Uint32Array(17), piece: new Uint32Array(0), rect: new Int16Array(0), floors: new Uint8Array(0), fh: new Float32Array(0), front: new Uint8Array(0), exp: new Uint8Array(0) };
      if (!t.pieceAttrs) t.pieceAttrs = { count: 0, piece: new Uint32Array(0), cls: new Uint8Array(0), roofShape: new Uint8Array(0), facadeMat: new Uint8Array(0), roofMat: new Uint8Array(0), roofHeight: new Float32Array(0), facadeColor: new Uint32Array(0), roofColor: new Uint32Array(0) };
    }
    return t;
  }

  // ---------- core.bin ----------
  const CORE_MAGIC = 0x4343594e;
  const DECK_THICKNESS = 1.2;
  const DECAL_WIDTH = [0.35, 0.12, 3.0];
  function toBuffer(input, what) {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) {
      return (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength)
        ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    throw new Error('NycData.' + what + ': ArrayBuffer expected');
  }
  // vxz: u32 nBytes | u8 bytes（zigzag LEB128。x, z の順。リング / 線 / 点の 1 つ目の頂点は 1 つ前のリングの 1 つ目から（最初は 0 から）、
  //   ほかは 1 つ前の頂点から）。starts = 各リングの頂点の始まり（長さ nRings + 1）。out[v·2] = ox + 値 · unit
  function vstream(r, starts, nVerts, unit, ox, oz, Out) {
    const nb = r.u32();
    const bytes = new Uint8Array(r.buf, r.p, nb);
    r.p += nb; r._align();
    const out = new (Out || Float32Array)(nVerts * 2);
    let p = 0, fx = 0, fz = 0, x = 0, z = 0;
    const rd = () => {
      let v = 0, sh = 0, b;
      do { b = bytes[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128);
      return (v >>> 1) ^ -(v & 1);
    };
    for (let k = 0; k + 1 < starts.length; k++) {
      for (let v = starts[k]; v < starts[k + 1]; v++) {
        if (v === starts[k]) { fx += rd(); fz += rd(); x = fx; z = fz; } else { x += rd(); z += rd(); }
        out[v * 2] = ox + x * unit; out[v * 2 + 1] = oz + z * unit;
      }
    }
    if (p !== nb) throw new Error('NycData: vxz stream length ' + p + ' != ' + nb);
    return out;
  }
  // vcount: u32 nBytes | 符号なし LEB128 の個数 n 個 → 始まりの位置 Uint32Array(n + 1)
  function vcounts(r, n) {
    const nb = r.u32();
    const bytes = new Uint8Array(r.buf, r.p, nb);
    r.p += nb; r._align();
    const st = new Uint32Array(n + 1);
    let p = 0;
    for (let i = 0; i < n; i++) {
      let v = 0, sh = 0, b;
      do { b = bytes[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128);
      st[i + 1] = st[i] + v;
    }
    if (p !== nb) throw new Error('NycData: vcount stream length ' + p + ' != ' + nb);
    return st;
  }
  function polyV(r, unit, ox, oz, Out) { // u32 n, nRings, nVerts | vcount ringCount[n] | vcount vertCount[nRings] | vxz
    const n = r.u32(), nRings = r.u32(), nVerts = r.u32();
    const ringStart = vcounts(r, n), vertStart = vcounts(r, nRings);
    return { count: n, ringStart, vertStart, xz: vstream(r, vertStart, nVerts, unit, ox, oz, Out) };
  }
  // DECK の片の平面 y = a·x + b·z + c（cm の頂点に、1 つ目の頂点のまわりで最小二乗。tools/nyc/nycv2geo.py の plane_of と同じ）
  function deckPlanes(D) {
    const pl = new Float64Array(D.count * 3);
    for (let i = 0; i < D.count; i++) {
      const a = D.vertStart[i], e = D.vertStart[i + 1];
      const x0 = D.xz[a * 2], z0 = D.xz[a * 2 + 1];
      let sxx = 0, sxz = 0, sx = 0, szz = 0, sz = 0, n = 0, sxy = 0, szy = 0, sy = 0;
      for (let v = a; v < e; v++) {
        const x = D.xz[v * 2] - x0, z = D.xz[v * 2 + 1] - z0, y = D.y[v];
        sxx += x * x; sxz += x * z; sx += x; szz += z * z; sz += z; n++; sxy += x * y; szy += z * y; sy += y;
      }
      // 正規方程式 [[sxx sxz sx][sxz szz sz][sx sz n]] [A B C] = [sxy szy sy]（クラメルの公式）
      const det = sxx * (szz * n - sz * sz) - sxz * (sxz * n - sz * sx) + sx * (sxz * sz - szz * sx);
      let A = 0, B = 0, C = sy / Math.max(1, n);
      if (Math.abs(det) > 1e-12) {
        A = (sxy * (szz * n - sz * sz) - sxz * (szy * n - sz * sy) + sx * (szy * sz - szz * sy)) / det;
        B = (sxx * (szy * n - sy * sz) - sxy * (sxz * n - sz * sx) + sx * (sxz * sy - szy * sx)) / det;
        C = (sxx * (szz * sy - szy * sz) - sxz * (sxz * sy - szy * sx) + sxy * (sxz * sz - szz * sx)) / det;
      }
      pl[i * 3] = A; pl[i * 3 + 1] = B; pl[i * 3 + 2] = C - A * x0 - B * z0;
    }
    return pl;
  }
  const polyI32 = (r, bits) => polyV(r, 0.1, 0, 0, bits === 64 ? Float64Array : Float32Array); // dm → m
  const polyQm = (r, c) => { const unit = r.u32() / 1000; return polyV(r, unit, c.minX, c.minZ); }; // u32 unitMm | poly（(minX, minZ) から unit m）
  function countsToStart(cnt) {
    const st = new Uint32Array(cnt.length + 1);
    for (let i = 0; i < cnt.length; i++) st[i + 1] = st[i] + cnt[i];
    return st;
  }
  // 片の外接矩形（E。p.bbox）と dev から、チャンクごとの片（p.chunkStart / chunkPieces: E ⊕ dev の外接矩形がチャンクに重なる片 =
  //   R が重なりうる片の上限）と支えの索引 c.supi（supCell m のセル → E ⊕ (dev + supPad) の外接矩形が触れる片）を作る。どちらも番号の小さい順
  function pieceIndex(c, p) {
    const n = p.count, X = p.xz, bb = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let v = p.vertStart[p.ringStart[i]], e = p.vertStart[p.ringStart[i] + 1]; v < e; v++) { // 外周だけ
        const x = X[v * 2], z = X[v * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      bb[i * 4] = x0; bb[i * 4 + 1] = z0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = z1;
    }
    p.bbox = bb;
    const lo = new Int32Array(n * 4);
    const grid = (cell, W, H, pad) => { // 範囲 → 数える → 置く
      for (let i = 0; i < n; i++) {
        const d = p.dev[i] + pad;
        lo[i * 4] = Math.max(0, Math.floor((bb[i * 4] - d - c.minX) / cell));
        lo[i * 4 + 1] = Math.min(W - 1, Math.floor((bb[i * 4 + 2] + d - c.minX) / cell));
        lo[i * 4 + 2] = Math.max(0, Math.floor((bb[i * 4 + 1] - d - c.minZ) / cell));
        lo[i * 4 + 3] = Math.min(H - 1, Math.floor((bb[i * 4 + 3] + d - c.minZ) / cell));
      }
      const cnt = new Uint32Array(W * H + 1);
      for (let i = 0; i < n; i++) for (let iz = lo[i * 4 + 2]; iz <= lo[i * 4 + 3]; iz++) for (let ix = lo[i * 4]; ix <= lo[i * 4 + 1]; ix++) cnt[iz * W + ix + 1]++;
      for (let k = 0; k < W * H; k++) cnt[k + 1] += cnt[k];
      const start = cnt.slice();
      const out = n < 65536 ? new Uint16Array(cnt[W * H]) : new Uint32Array(cnt[W * H]);
      for (let i = 0; i < n; i++) for (let iz = lo[i * 4 + 2]; iz <= lo[i * 4 + 3]; iz++) for (let ix = lo[i * 4]; ix <= lo[i * 4 + 1]; ix++) out[cnt[iz * W + ix]++] = i;
      return { start, piece: out };
    };
    const ch = grid(c.chunk, c.ncx, c.ncz, 0);
    p.chunkStart = ch.start;
    p.chunkPieces = ch.piece;
    const W = Math.ceil((c.maxX - c.minX) / p.supCell), H = Math.ceil((c.maxZ - c.minZ) / p.supCell);
    const su = grid(p.supCell, W, H, p.supPad);
    c.supi = { cell: p.supCell, W, H, pad: p.supPad, start: su.start, piece: su.piece };
  }
  const CORE = {
    LAND(r, c) { c.land = polyI32(r, 64); },
    LGRD(r, c) {
      const cell = r.u32(), W = r.u32(), H = r.u32(), nRuns = r.u32();
      const rowStart = r.arr(Uint32Array, H + 1), runs = r.arr(Uint16Array, nRuns);
      const nMixed = r.u32();
      const mixedRuns = r.arr(Uint8Array, nMixed);
      const nEdgeRuns = r.u32();
      const edge = r.arr(Uint32Array, nEdgeRuns), len = r.arr(Uint8Array, nEdgeRuns);
      const grid = new Uint8Array(W * H);
      const mixRowStart = new Uint32Array(H + 1), mixCols = new Uint16Array(nMixed);
      let m = 0;
      for (let j = 0; j < H; j++) {
        let i = 0;
        const row = j * W;
        for (let k = rowStart[j]; k < rowStart[j + 1]; k++) {
          const v = runs[k] >> 14, L = runs[k] & 16383;
          if (v === 1) grid.fill(1, row + i, row + i + L);
          else if (v === 2) { grid.fill(2, row + i, row + i + L); for (let q = 0; q < L; q++) mixCols[m++] = i + q; }
          i += L;
        }
        mixRowStart[j + 1] = m;
      }
      c.lgrd = { cell, W, H, x0: c.minX, z0: c.minZ, grid, mixRowStart, mixCols, runStart: countsToStart(mixedRuns), edge, len };
      c.grid = grid;
    },
    WATR(r, c) {
      const b = polyI32(r, 32);
      b.y = scaled(r.arr(Int16Array, b.count), 0.01);
      b.bed = scaled(r.arr(Int16Array, b.count), 0.01);
      b.sub = r.arr(Uint8Array, b.count);
      c.water = b;
    },
    PARK(r, c) { const b = polyQm(r, c); b.kind = r.arr(Uint8Array, b.count); c.parks = b; },
    'RDS '(r, c) {
      const n = r.u32(), nVerts = r.u32();
      const vertStart = vcounts(r, n);
      const xz = vstream(r, vertStart, nVerts, 0.25, c.minX, c.minZ);
      const y = scaled(r.arr(Int16Array, nVerts), 0.01);
      c.roads = {
        count: n, vertStart, xz, y, cls: r.arr(Uint8Array, n), flags: r.arr(Uint8Array, n),
        curbL: scaled(r.arr(Uint8Array, n), 0.1), curbR: scaled(r.arr(Uint8Array, n), 0.1),
        swL: scaled(r.arr(Uint8Array, n), 0.1), swR: scaled(r.arr(Uint8Array, n), 0.1)
      };
    },
    DECK(r, c) {
      const n = r.u32(), nVerts = r.u32();
      const vertStart = vcounts(r, n);
      const xz = vstream(r, vertStart, nVerts, 0.01, 0, 0, Float64Array);
      const yq = r.arr(Int16Array, nVerts);
      const y = new Float64Array(nVerts);
      for (let i = 0; i < nVerts; i++) y[i] = yq[i] * 0.01;
      c.decks = {
        count: n, vertStart, xz, y, plane: null, chain: r.arr(Uint32Array, n),
        seq: r.arr(Uint16Array, n), kind: r.arr(Uint8Array, n), cls: r.arr(Uint8Array, n), rds: r.arr(Uint32Array, n),
        thickness: DECK_THICKNESS
      };
      c.decks.plane = deckPlanes(c.decks);
    },
    'PRT '(r, c) {
      const n = r.u32(), nRings = r.u32(), nVerts = r.u32(), supCell = r.u32();
      const supPad = r.dv.getFloat32(r.p, true); r.p += 4;
      const ringStart = vcounts(r, n), vertStart = vcounts(r, nRings);
      const xz = vstream(r, vertStart, nVerts, 0.1, 0, 0);
      const gid0 = r.u32();
      const gd = r.arr(Uint8Array, n);
      const gid = new Uint32Array(n);
      let g = gid0;
      for (let i = 0; i < n; i++) { g += gd[i]; gid[i] = g; }
      const p = { count: n, ringStart, vertStart, xz, gid, supCell, supPad };
      p.y0 = scaled(r.arr(Uint16Array, n), 0.1);
      p.y1f = scaled(r.arr(Uint16Array, n), 0.1);
      p.dev = scaled(r.arr(Uint8Array, n), 0.1);
      p.style = r.arr(Uint8Array, n);
      p.floors = r.arr(Uint8Array, n);
      p.flags = r.arr(Uint8Array, n);
      p.y1c = new Float32Array(n);
      for (let i = 0; i < n; i++) p.y1c[i] = (Math.round(p.y1f[i] * 10) + (p.flags[i] & 64 ? 1 : 0)) * 0.1;
      c.pieces = p;
    },
    ENTB(r, c) { c.entb = entbCols(r, r.u32()); },
    MASS(r, c) {
      const nChunks = r.u32();
      const chunkStart = countsToStart(r.arr(Uint16Array, nChunks));
      const b = polyQm(r, c);
      b.h = scaled(r.arr(Uint16Array, b.count), 0.1);
      b.cover = scaled(r.arr(Uint8Array, b.count), 1 / 255);
      b.chunkStart = chunkStart;
      c.mass = b;
    },
    HPAD(r, c) {
      const n = r.u32();
      const xz = scaled(r.arr(Int32Array, n * 2), 0.1);
      c.helipads = { count: n, xz, y: scaled(r.arr(Uint16Array, n), 0.1), r: scaled(r.arr(Uint16Array, n), 0.1), roof: r.arr(Uint8Array, n), heliport: r.arr(Uint8Array, n) };
    },
    SPWN(r, c) {
      const n = r.u32();
      const st = new Uint32Array(n + 1);
      for (let i = 0; i <= n; i++) st[i] = i;
      const xz = vstream(r, st, n, 0.25, c.minX, c.minZ);
      c.spawns = { count: n, xz, zone: r.arr(Uint8Array, n), mask: r.arr(Uint8Array, n) };
    },
    HERO(r, c) { c.hero = { count: r.u32() }; },
    RLEL(r, c) {
      const n = r.u32(), nVerts = r.u32();
      const vertStart = vcounts(r, n);
      const xz = vstream(r, vertStart, nVerts, 0.1, 0, 0);
      const y = scaled(r.arr(Int16Array, nVerts), 0.01);
      const lines = { count: n, vertStart, xz, y, cls: r.arr(Uint8Array, n), flags: r.arr(Uint8Array, n) };
      const np = r.u32();
      const pxz = scaled(r.arr(Int32Array, np * 2), 0.1);
      const yq = r.arr(Uint16Array, np), wq = r.arr(Uint16Array, np), hq = r.arr(Int16Array, np);
      const yaw = new Float32Array(np), width = new Float32Array(np), py = new Float32Array(np);
      for (let i = 0; i < np; i++) { yaw[i] = yq[i] * (Math.PI * 2 / 65536); width[i] = wq[i] * 0.1; py[i] = hq[i] * 0.01; }
      const portals = { count: np, xz: pxz, yaw, width, y: py, flags: r.arr(Uint8Array, np), tracks: r.arr(Uint8Array, np) };
      const nf = r.u32();
      const fStart = vcounts(r, nf);
      const fxz = vstream(r, fStart, fStart[nf], 0.1, 0, 0);
      const plats = { count: nf, vertStart: fStart, xz: fxz, y: scaled(r.arr(Int16Array, nf), 0.01) };
      c.rlel = { lines, portals, plats };
    },
    STAT(r, c) {
      const n = r.u32();
      const pts = (m) => { const st = new Uint32Array(m + 1); for (let i = 0; i <= m; i++) st[i] = i; return st; };
      const xz = vstream(r, pts(n), n, 0.1, 0, 0);
      const depth = r.arr(Uint8Array, n), flags = r.arr(Uint8Array, n), mq = r.arr(Int16Array, n);
      const mezz = new Float32Array(n);
      for (let i = 0; i < n; i++) mezz[i] = mq[i] === -32768 ? NaN : mq[i] * 0.01;
      const entStart = vcounts(r, n), platStart = vcounts(r, n);
      const ne = r.u32();
      const exz = vstream(r, pts(ne), ne, 0.1, 0, 0);
      const ey = r.arr(Uint8Array, ne);
      const yaw = new Float32Array(ne);
      for (let i = 0; i < ne; i++) yaw[i] = ey[i] * (Math.PI * 2 / 256);
      const ents = { count: ne, xz: exz, yaw, w: scaled(r.arr(Uint8Array, ne), 0.1), l: scaled(r.arr(Uint8Array, ne), 0.1), kind: r.arr(Uint8Array, ne) };
      const np = r.u32();
      const pxz = vstream(r, pts(np), np, 0.1, 0, 0);
      const pyq = r.arr(Uint16Array, np);
      const pyaw = new Float32Array(np);
      for (let i = 0; i < np; i++) pyaw[i] = pyq[i] * (Math.PI * 2 / 65536);
      const plats = { count: np, xz: pxz, yaw: pyaw, hl: scaled(r.arr(Uint16Array, np), 0.05), hw: scaled(r.arr(Uint8Array, np), 0.05), y: scaled(r.arr(Int16Array, np), 0.01), flags: r.arr(Uint8Array, np) };
      if (entStart[n] !== ne || platStart[n] !== np) throw new Error('NycData: STAT counts');
      c.stat = { count: n, xz, depth, flags, mezz, entStart, platStart, ents, plats };
    }
  };
  const CORE_ORDER = ['LAND', 'LGRD']; // LGRD needs LAND; the rest in file order

  function decodeCore(input) {
    const buf = toBuffer(input, 'decodeCore');
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== CORE_MAGIC) throw new Error('NycData: not a NYC core pack');
    const version = dv.getUint16(4, true);
    if (version !== 2) throw new Error('NycData: unsupported core version ' + version + ' (expected 2)');
    const nSec = dv.getUint16(6, true);
    const c = {
      version, minX: dv.getInt32(8, true), minZ: dv.getInt32(12, true), maxX: dv.getInt32(16, true), maxZ: dv.getInt32(20, true),
      chunk: dv.getUint16(24, true), tile: dv.getUint16(26, true), ncx: dv.getUint16(28, true), ncz: dv.getUint16(30, true),
      byteLength: buf.byteLength, sections: {}
    };
    const table = [];
    for (let i = 0; i < nSec; i++) {
      const o = 32 + i * 12;
      const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      table.push([tag, dv.getUint32(o + 4, true)]);
      c.sections[tag.trim()] = dv.getUint32(o + 8, true);
    }
    const rank = (t) => { const i = CORE_ORDER.indexOf(t); return i < 0 ? 99 : i; };
    table.sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [tag, off] of table) if (CORE[tag]) CORE[tag](new Reader(buf, off), c);
    if (c.land) c.landNext = landNext(c.land);
    if (c.pieces) pieceIndex(c, c.pieces);
    c.isLand = (x, z) => isLand(c, x, z);
    c.landCell = (x, z) => landCell(c, x, z);
    return c;
  }
  // LAND の辺 e（始点の頂点番号）の終点
  function landNext(b) {
    const nv = b.vertStart[b.vertStart.length - 1];
    const next = new Uint32Array(nv);
    for (let k = 0; k + 1 < b.vertStart.length; k++) {
      const a = b.vertStart[k], e = b.vertStart[k + 1];
      for (let v = a; v < e; v++) next[v] = v + 1 < e ? v + 1 : a;
    }
    return next;
  }
  // 4 m の格子のセル（0 水, 1 陸, 2 混ざり。世界の外は 0）
  function landCell(c, x, z) {
    const g = c.lgrd;
    const ix = Math.floor((x - g.x0) / g.cell), iz = Math.floor((z - g.z0) / g.cell);
    if (ix < 0 || iz < 0 || ix >= g.W || iz >= g.H) return 0;
    return g.grid[iz * g.W + ix];
  }
  // 点が陸（LAND の中）か。純粋なセルは O(1)、混ざりのセルは +x へ純粋なセルまで、各セルの辺だけで交差を数える
  function isLand(c, x, z) {
    const g = c.lgrd;
    const ix = Math.floor((x - g.x0) / g.cell), iz = Math.floor((z - g.z0) / g.cell);
    if (ix < 0 || iz < 0 || ix >= g.W || iz >= g.H) return false;
    const row = iz * g.W;
    const v0 = g.grid[row + ix];
    if (v0 !== 2) return v0 === 1;
    const X = c.land.xz, next = c.landNext;
    let parity = false;
    for (let cc = ix; cc < g.W; cc++) {
      const v = g.grid[row + cc];
      if (v !== 2) return (v === 1) !== parity;
      let lo = g.mixRowStart[iz], hi = g.mixRowStart[iz + 1] - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (g.mixCols[m] < cc) lo = m + 1; else hi = m; }
      const cx0 = g.x0 + cc * g.cell, cx1 = cx0 + g.cell;
      for (let k = g.runStart[lo]; k < g.runStart[lo + 1]; k++) {
        const e1 = g.edge[k] + g.len[k];
        for (let e = g.edge[k]; e < e1; e++) {
          const b = next[e];
          const za = X[e * 2 + 1], zb = X[b * 2 + 1];
          if ((za > z) !== (zb > z)) {
            const xa = X[e * 2];
            const xc = xa + (z - za) * (X[b * 2] - xa) / (zb - za);
            if (xc > x && xc >= cx0 && (xc < cx1 || cc === g.W - 1)) parity = !parity; // the last column owns the world edge
          }
        }
      }
    }
    return parity;
  }
  function pieceY(c, i) {
    const p = c.pieces;
    return { y0: p.y0[i], y1f: p.y1f[i], y1c: p.y1c[i], dev: p.dev[i] };
  }
  // 版 2 のチャンク行の範囲 [a, b)（block = prisms / plinths / decals / props / fences / entb）
  function chunkRows(block, t, cx, cz) {
    const lx = cx - t.tx * 4, lz = cz - t.tz * 4;
    if (!block || lx < 0 || lz < 0 || lx > 3 || lz > 3) return [0, 0];
    const k = lz * 4 + lx;
    return [block.rowStart[k], block.rowStart[k + 1]];
  }

  // 版 2: タイルの CPAT（描画だけの属性）で片 piece の行番号（無ければ −1。片の番号の順に並んでいるので二分探索）
  function pieceAttr(t, piece) {
    const A = t.pieceAttrs;
    if (!A || !A.count) return -1;
    let lo = 0, hi = A.count - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, v = A.piece[m]; if (v === piece) return m; if (v < piece) lo = m + 1; else hi = m - 1; }
    return -1;
  }

  // ---------- タイルの位置 ----------
  function tileKey(tx, tz) { return tx + '_' + tz; }
  function tileOf(meta, x, z) {
    const b = meta.bounds;
    return [Math.floor((x - b.minX) / meta.tile), Math.floor((z - b.minZ) / meta.tile)];
  }
  function tileRect(meta, tx, tz) {
    const b = meta.bounds;
    const x0 = b.minX + tx * meta.tile, z0 = b.minZ + tz * meta.tile;
    return [x0, z0, x0 + meta.tile, z0 + meta.tile];
  }
  function hasTile(meta, tx, tz) { return !!meta.tiles[tileKey(tx, tz)]; }
  function tileUrl(meta, tx, tz) { return 'levels/nyc/t_' + tx + '_' + tz + '.bin'; }
  function tilesInRect(meta, x0, z0, x1, z1) {
    const a = tileOf(meta, x0, z0), b = tileOf(meta, x1, z1);
    const out = [];
    for (let tx = Math.max(0, a[0]); tx <= Math.min(meta.tilesX - 1, b[0]); tx++) {
      for (let tz = Math.max(0, a[1]); tz <= Math.min(meta.tilesZ - 1, b[1]); tz++) if (hasTile(meta, tx, tz)) out.push([tx, tz]);
    }
    return out;
  }

  // ---------- 便利関数（ツール・デバッグ用） ----------
  function rings(block, i) {
    const out = [];
    for (let k = block.ringStart[i]; k < block.ringStart[i + 1]; k++) out.push(k);
    return out;
  }
  function ring(block, k) {
    return block.xz.slice(block.vertStart[k] * 2, block.vertStart[k + 1] * 2);
  }
  function signedArea(xz, a, b) {
    let s = 0;
    for (let i = a; i < b; i++) {
      const j = i + 1 < b ? i + 1 : a;
      s += xz[i * 2] * xz[j * 2 + 1] - xz[j * 2] * xz[i * 2 + 1];
    }
    return s / 2;
  }
  function polyRings(block, i) { return rings(block, i).map((k) => Array.from(ring(block, k))); }
  function building(t, i) {
    const b = t.buildings;
    const parts = [];
    for (let k = b.partStart[i]; k < b.partStart[i + 1]; k++) parts.push(part(t, k));
    return {
      gid: b.gid[i], rings: polyRings(b, i), height: b.height[i], minHeight: b.minHeight[i], roofHeight: b.roofHeight[i],
      name: t.strings[b.name[i]], facadeColor: b.facadeColor[i], roofColor: b.roofColor[i], flags: b.flags[i],
      floors: b.floors[i], cls: b.cls[i], style: b.style[i], roofShape: b.roofShape[i], facadeMat: b.facadeMat[i],
      roofMat: b.roofMat[i], parts
    };
  }
  function part(t, i) {
    const p = t.parts;
    return {
      parent: p.parent[i], rings: polyRings(p, i), height: p.height[i], minHeight: p.minHeight[i], roofHeight: p.roofHeight[i],
      name: t.strings[p.name[i]], facadeColor: p.facadeColor[i], roofColor: p.roofColor[i], roofShape: p.roofShape[i],
      facadeMat: p.facadeMat[i], roofMat: p.roofMat[i], estimated: !!(p.estimated[i] & 1), remainder: !!(p.estimated[i] & 2)
    };
  }
  function road(t, i) {
    const r = t.roads;
    const a = r.vertStart[i], b = r.vertStart[i + 1];
    return {
      xz: Array.from(r.xz.subarray(a * 2, b * 2)), y: Array.from(r.y.subarray(a, b)), cls: r.cls[i], flags: r.flags[i],
      level: r.level[i], curbL: r.curbL[i], curbR: r.curbR[i], swL: r.swL[i], swR: r.swR[i], name: t.strings[r.name[i]]
    };
  }
  function area(t, i) {
    const a = t.areas;
    return { rings: polyRings(a, i), kind: a.kind[i], sub: a.sub[i], name: t.strings[a.name[i]], y: a.y[i] };
  }
  // 点 (x, z) が多角形ブロックの i 番（外周の中で、どの穴の中でもない）に入っているか
  function insideRing(xz, a, b, x, z) {
    let c = false;
    for (let i = a, j = b - 1; i < b; j = i++) {
      const xi = xz[i * 2], zi = xz[i * 2 + 1], xj = xz[j * 2], zj = xz[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  function pointIn(block, i, x, z) {
    const r0 = block.ringStart[i], r1 = block.ringStart[i + 1];
    if (!insideRing(block.xz, block.vertStart[r0], block.vertStart[r0 + 1], x, z)) return false;
    for (let k = r0 + 1; k < r1; k++) if (insideRing(block.xz, block.vertStart[k], block.vertStart[k + 1], x, z)) return false;
    return true;
  }
  function enumName(meta, kind, c) { return (meta.enums[kind] || [])[c] || ''; }
  function enumCode(meta, kind, name) { return (meta.enums[kind] || []).indexOf(name); }

  const NycData = {
    MAGIC, CORE_MAGIC, DECK_THICKNESS, DECAL_WIDTH, decodeTile, decodeCore, isLand, landCell, pieceY, chunkRows, pieceAttr,
    tileKey, tileOf, tileRect, hasTile, tileUrl, tilesInRect,
    rings, ring, signedArea, pointIn, building, part, road, area, enumName, enumCode
  };
  MR.NycData = NycData;
  if (typeof module !== 'undefined' && module.exports) module.exports = NycData;
})(typeof window !== 'undefined' ? window : globalThis);
