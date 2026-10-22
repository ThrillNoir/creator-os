const W = 360;
const H = 640;
const HORIZON = 104;
const PLAYER_GROUND_Y = 550;
const FOREGROUND_DISTANCE = 42;
const REAR_DISTANCE = 48;
const LANE_OFFSETS = [-1, 0, 1];

function polygon(ctx, points, fill, stroke, width = 1) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function trackY(ahead) {
  if (ahead >= 0) {
    const t = Math.min(1, ahead / FOREGROUND_DISTANCE);
    return PLAYER_GROUND_Y + Math.pow(t, .8) * 125;
  }
  const t = Math.min(1, -ahead / REAR_DISTANCE);
  return PLAYER_GROUND_Y - Math.pow(t, .65) * (PLAYER_GROUND_Y - HORIZON - 20);
}

function roadHalfWidth(y) {
  const depth = Math.max(0, (y - HORIZON - 16) / (H - HORIZON - 16));
  const foregroundFlare = Math.max(0, (y - PLAYER_GROUND_Y) / (H + 35 - PLAYER_GROUND_Y)) * 40;
  return Math.min(W / 2, 10 + depth * 128 + foregroundFlare);
}

function wallTopY(groundY) {
  const depth = Math.max(0, (groundY - HORIZON - 16) / (H - HORIZON - 16));
  return 88 - depth * 90;
}

function wallOpeningEdge(ahead, side, height, lift = 0) {
  const footY = trackY(Math.max(-REAR_DISTANCE, Math.min(FOREGROUND_DISTANCE, ahead)));
  const scale = Math.max(0, (footY - HORIZON) / (H - HORIZON));
  const x = W / 2 + side * (roadHalfWidth(footY) + 4);
  const bottom = footY - lift * scale;
  return { x, top: bottom - height * scale, bottom };
}

function drawWallOpening(ctx, ahead, side, kind) {
  const footY = trackY(ahead);
  const scale = Math.max(0, (footY - HORIZON) / (H - HORIZON));
  const span = 7 + scale * 7;
  const door = kind === 'door';
  // A doorway should clear the runner at the same depth. Its height is scaled
  // by the wall projection, just like the windows beside it.
  const far = wallOpeningEdge(ahead - span / 2, side, door ? 288 : 72, door ? 0 : 238);
  const near = wallOpeningEdge(ahead + span / 2, side, door ? 288 : 72, door ? 0 : 238);
  const outline = [[far.x, far.top], [near.x, near.top], [near.x, near.bottom], [far.x, far.bottom]];
  if (!door && scale > .3) {
    ctx.save();
    ctx.shadowColor = '#f4ae67'; ctx.shadowBlur = 12 * scale;
    polygon(ctx, outline, 'rgba(255,176,91,.33)');
    ctx.restore();
  }
  polygon(ctx, outline, door ? '#232a2f' : '#3b302e', door ? '#aa856b' : '#c99a64', Math.max(1, scale * 2));
  const inset = .07;
  const farInnerX = far.x + (near.x - far.x) * inset;
  const nearInnerX = near.x + (far.x - near.x) * inset;
  const farInnerTop = far.top + (far.bottom - far.top) * .07;
  const nearInnerTop = near.top + (near.bottom - near.top) * .07;
  const farInnerBottom = far.bottom - (far.bottom - far.top) * .04;
  const nearInnerBottom = near.bottom - (near.bottom - near.top) * .04;
  polygon(ctx, [[farInnerX, farInnerTop], [nearInnerX, nearInnerTop],
    [nearInnerX, nearInnerBottom], [farInnerX, farInnerBottom]],
  door ? '#424c50' : '#f4bd78');
  ctx.strokeStyle = door ? 'rgba(196,177,151,.42)' : 'rgba(78,52,43,.72)';
  ctx.lineWidth = Math.max(1, scale * 1.5);
  for (const row of door ? [.18, .32, .46, .6, .74, .88] : [.5]) {
    ctx.beginPath();
    ctx.moveTo(far.x, far.top + (far.bottom - far.top) * row);
    ctx.lineTo(near.x, near.top + (near.bottom - near.top) * row);
    ctx.stroke();
  }
  if (!door) {
    const midX = (far.x + near.x) / 2;
    const midTop = (far.top + near.top) / 2;
    const midBottom = (far.bottom + near.bottom) / 2;
    ctx.strokeStyle = '#483938'; ctx.lineWidth = Math.max(1, scale * 2);
    ctx.beginPath(); ctx.moveTo(midX, midTop); ctx.lineTo(midX, midBottom); ctx.stroke();
    ctx.fillStyle = 'rgba(255,238,174,.65)';
    ctx.fillRect(Math.round(midX + side * 2), Math.round(midTop + 3 * scale), Math.max(1, scale * 2), Math.max(2, scale * 12));
  }
  if (door) {
    ctx.fillStyle = '#deb182';
    ctx.fillRect(near.x + (far.x - near.x) * .2, near.top + (near.bottom - near.top) * .58,
      Math.max(1, scale * 2), Math.max(1, scale * 3));
  }
}

function markNoise(value) {
  const noise = Math.sin(value * 127.1 + 78.233) * 43758.5453;
  return noise - Math.floor(noise);
}

function wallPoint(far, near, along, down) {
  const x = far.x + (near.x - far.x) * along;
  const top = far.top + (near.top - far.top) * along;
  const foot = far.foot + (near.foot - far.foot) * along;
  return [Math.round(x), Math.round(top + (foot - top) * down)];
}

function drawBrickBay(ctx, far, near, section, side) {
  const courses = 25;
  const colours = side < 0
    ? ['#56373a', '#62403e', '#6d4640', '#744941', '#4c3438']
    : ['#343d41', '#3d4649', '#465052', '#4d5555', '#33383e'];
  polygon(ctx, [wallPoint(far, near, 0, 0), wallPoint(far, near, 1, 0),
    wallPoint(far, near, 1, 1), wallPoint(far, near, 0, 1)], '#2b252c');

  for (let row = 0; row < courses; row += 1) {
    const joints = row % 2 ? [0, .5, 1] : [0, 1];
    for (let brick = 0; brick < joints.length - 1; brick += 1) {
      const start = joints[brick];
      const end = joints[brick + 1];
      const tone = Math.floor(markNoise(section * 41 + row * 13 + brick * 7 + side * 3) * colours.length);
      const top = (row + .025) / courses;
      const bottom = (row + .975) / courses;
      const left = start + .006;
      const right = end - .006;
      const a = wallPoint(far, near, left, top);
      const b = wallPoint(far, near, right, top);
      const c = wallPoint(far, near, right, bottom);
      const d = wallPoint(far, near, left, bottom);
      polygon(ctx, [a, b, c, d], colours[tone]);
      const width = Math.abs(b[0] - a[0]);
      const height = Math.abs(d[1] - a[1]);
      if (width > 7 && height > 6) {
        ctx.strokeStyle = 'rgba(244,167,122,.22)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a[0] + (side < 0 ? 1 : -1), a[1] + 1);
        ctx.lineTo(b[0] + (side < 0 ? 1 : -1), b[1] + 1); ctx.stroke();
        if (markNoise(section * 97 + row * 29 + brick * 5 + side) > .7) {
          const chipX = Math.round((a[0] + b[0]) / 2);
          const chipY = Math.round((a[1] + d[1]) / 2);
          ctx.fillStyle = side < 0 ? '#91615a' : '#718081';
          ctx.fillRect(chipX, chipY, Math.max(2, Math.min(5, width / 5)), 2);
          ctx.fillStyle = '#342b32';
          ctx.fillRect(chipX + 2, chipY + 2, 3, 2);
        }
      }
    }
  }

  const ledgeTop = [wallPoint(far, near, 0, .225), wallPoint(far, near, 1, .225)];
  const ledgeBottom = [wallPoint(far, near, 1, .24), wallPoint(far, near, 0, .24)];
  polygon(ctx, [...ledgeTop, ...ledgeBottom], side < 0 ? '#342d34' : '#292f34');
  ctx.strokeStyle = side < 0 ? '#a37462' : '#7a8583'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(...ledgeTop[0]); ctx.lineTo(...ledgeTop[1]); ctx.stroke();

  // Damp blocks at pavement height and a narrow downpipe break up the
  // masonry without introducing screen-fixed decoration.
  if (section % 3 === 0) {
    for (let patch = 0; patch < 3; patch += 1) {
      const along = .12 + patch * .3;
      const top = wallPoint(far, near, along, .92 + markNoise(section * 11 + patch) * .035);
      const bottom = wallPoint(far, near, Math.min(1, along + .15), 1);
      polygon(ctx, [top, wallPoint(far, near, along + .15, .93), bottom,
        wallPoint(far, near, along, 1)], 'rgba(28,35,41,.28)');
    }
  }
  if (section % 5 === 0) {
    const pipeX = Math.round(near.x + side * 4);
    const pipeWidth = Math.max(1, Math.round(Math.abs(near.x - far.x) / 12));
    ctx.fillStyle = '#262c31';
    ctx.fillRect(pipeX, Math.round(near.top), pipeWidth + 2, Math.max(0, Math.round(near.foot - near.top)));
    ctx.fillStyle = '#808076';
    ctx.fillRect(pipeX + 1, Math.round(near.top), 1, Math.max(0, Math.round(near.foot - near.top)));
    ctx.fillStyle = '#ae8c71';
    for (const down of [.3, .67]) {
      const y = Math.round(near.top + (near.foot - near.top) * down);
      ctx.fillRect(pipeX - 1, y, pipeWidth + 4, 2);
    }
  }
}

function drawPassingGround(ctx, distance) {
  // New concrete enters at the bottom, reaches the runner, then recedes toward
  // the boulder and horizon as the camera retreats with her.
  const first = Math.floor((distance - REAR_DISTANCE) / 6);
  const last = Math.ceil((distance + FOREGROUND_DISTANCE) / 6);
  for (let section = first; section <= last; section += 1) {
    const ahead = section * 6 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const y = trackY(ahead);
    const t = Math.max(0, Math.min(1.15, (y - HORIZON) / (H - HORIZON)));
    const halfWidth = roadHalfWidth(y);
    if (section % 2 === 0 && y > HORIZON + 42 && y < H + 8) {
      ctx.strokeStyle = `rgba(154,157,154,${(.035 + t * .075).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, Math.round(t * 2));
      ctx.beginPath(); ctx.moveTo(W / 2 - halfWidth + 7, Math.round(y));
      ctx.lineTo(W / 2 + halfWidth - 7, Math.round(y)); ctx.stroke();
    }
    const offset = (markNoise(section) * 1.5 - .75) * halfWidth;
    const x = W / 2 + offset;
    const width = 5 + t * 35;
    const height = 1 + t * 6;
    ctx.fillStyle = `rgba(74,143,152,${(.08 + t * .22).toFixed(3)})`;
    polygon(ctx, [[x - width, y], [x + width * .35, y - height], [x + width, y], [x - width * .1, y + height]], ctx.fillStyle);
    if (t > .45) {
      ctx.fillStyle = 'rgba(146,192,186,.18)';
      ctx.fillRect(Math.round(x - width * .32), Math.round(y - height / 2),
        Math.max(2, Math.round(width * .48)), Math.max(1, Math.round(t * 2)));
    }
    ctx.strokeStyle = `rgba(191,174,161,${(0.03 + t * .13).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, t * 1.4);
    ctx.beginPath();
    ctx.moveTo(x - width * .65, y + height * 2.1);
    ctx.lineTo(x + width * .15, y + height * 2.5);
    ctx.lineTo(x + width * .7, y + height * 1.7);
    ctx.stroke();
  }

  const windowFirst = Math.floor((distance - REAR_DISTANCE - 8) / 18);
  const windowLast = Math.ceil((distance + FOREGROUND_DISTANCE - 8) / 18);
  for (let section = windowFirst; section <= windowLast; section += 1) {
    const ahead = section * 18 + 8 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const y = trackY(ahead);
    if (y < HORIZON + 50 || y > H + 12) continue;
    const scale = Math.max(0, (y - HORIZON) / (H - HORIZON));
    for (const side of [-1, 1]) {
      const detail = markNoise(section * 3 + side);
      if (detail < .17 || detail > .53) continue;
      const x = W / 2 + side * (roadHalfWidth(y) - 18 * scale);
      for (const [offset, length, alpha] of [[1, 8, .3], [9, 16, .35], [21, 10, .24], [35, 6, .13]]) {
        ctx.fillStyle = `rgba(246,172,103,${alpha})`;
        ctx.fillRect(Math.round(x - length * scale / 2), Math.round(y + offset * scale),
          Math.max(2, Math.round(length * scale)), Math.max(1, Math.round(scale * 2)));
      }
    }
  }

  // Window and lamp light catches in the wet gutter. These world-space marks
  // enter below the screen and recede with the paving, like the hazards.
  const firstLight = Math.floor((distance - REAR_DISTANCE - 14) / 48);
  const lastLight = Math.ceil((distance + FOREGROUND_DISTANCE - 14) / 48);
  for (let section = firstLight; section <= lastLight; section += 1) {
    const ahead = section * 48 + 14 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const y = trackY(ahead);
    if (y < HORIZON + 30 || y > H + 18) continue;
    const scale = Math.max(0, (y - HORIZON) / (H - HORIZON));
    const side = section % 2 === 0 ? -1 : 1;
    const x = W / 2 + side * (roadHalfWidth(y) - 12 * scale);
    const width = Math.max(2, 17 * scale);
    polygon(ctx, [[x - width, y + 4], [x + width, y + 2],
      [x + width * .7, y + 12 * scale], [x - width * .55, y + 10 * scale]],
    'rgba(197,121,73,.16)');
    ctx.fillStyle = 'rgba(255,190,111,.45)';
    for (const [offset, length] of [[2, 8], [9, 14], [19, 7]]) {
      ctx.fillRect(Math.round(x - length * scale / 2), Math.round(y + offset * scale),
        Math.max(2, Math.round(length * scale)), Math.max(1, Math.round(scale * 2)));
    }
  }

  const neonFirst = Math.floor((distance - REAR_DISTANCE + 12) / 96);
  const neonLast = Math.ceil((distance + FOREGROUND_DISTANCE + 12) / 96);
  for (let section = neonFirst; section <= neonLast; section += 1) {
    const ahead = section * 96 - 12 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const y = trackY(ahead);
    if (y < HORIZON + 45 || y > H + 10) continue;
    const scale = Math.max(.2, (y - HORIZON) / (H - HORIZON));
    const x = W / 2 + roadHalfWidth(y) * .66;
    polygon(ctx, [[x - 15 * scale, y + 3], [x + 18 * scale, y],
      [x + 12 * scale, y + 20 * scale], [x - 8 * scale, y + 17 * scale]],
    'rgba(213,72,137,.16)');
    ctx.fillStyle = 'rgba(255,123,190,.53)';
    for (const [offset, length] of [[5, 10], [13, 19], [26, 8], [37, 14]]) {
      ctx.fillRect(Math.round(x - length * scale / 2), Math.round(y + offset * scale),
        Math.max(2, Math.round(length * scale)), Math.max(1, Math.round(scale * 2)));
    }
  }
}

function drawWallLamp(ctx, ahead, side) {
  const footY = trackY(ahead);
  const scale = Math.max(0, (footY - HORIZON) / (H - HORIZON));
  if (scale < .15) return;
  const x = Math.round(W / 2 + side * (roadHalfWidth(footY) + 3));
  const y = Math.round(footY - 322 * scale);
  const size = Math.max(2, Math.round(8 * scale));
  ctx.save();
  ctx.fillStyle = 'rgba(246,183,104,.13)';
  ctx.fillRect(x - size * 2, y - size, size * 4, size * 3);
  ctx.fillStyle = '#252b30';
  ctx.fillRect(x - side * size, y - size, Math.max(2, size * 2), Math.max(2, size / 2));
  ctx.fillRect(x - size / 2, y - size, Math.max(2, size), Math.max(2, size * 1.5));
  ctx.shadowColor = '#ffc078'; ctx.shadowBlur = 12 * scale;
  ctx.fillStyle = '#ffcf87';
  ctx.fillRect(x - size / 2, y + size / 2, Math.max(2, size), Math.max(2, size / 2));
  ctx.restore();
}

function drawWallDetail(ctx, ahead, side, poster) {
  const footY = trackY(ahead);
  const scale = Math.max(0, (footY - HORIZON) / (H - HORIZON));
  if (scale < .19 || footY > H + 35) return;
  const span = poster ? 5 : 4;
  const far = wallOpeningEdge(ahead - span, side, poster ? 94 : 63, poster ? 164 : 206);
  const near = wallOpeningEdge(ahead + span, side, poster ? 94 : 63, poster ? 164 : 206);
  const frame = [[far.x, far.top], [near.x, near.top], [near.x, near.bottom], [far.x, far.bottom]];
  polygon(ctx, frame, poster ? '#2b252d' : '#22292e', poster ? '#967b70' : '#738080', Math.max(1, scale));
  const inside = [[far.x, far.top + 3 * scale], [near.x, near.top + 3 * scale],
    [near.x, near.bottom - 3 * scale], [far.x, far.bottom - 3 * scale]];
  polygon(ctx, inside, poster ? '#c57991' : '#2c353b');
  if (poster) {
    const stripe = (t) => [
      [far.x, far.top + (far.bottom - far.top) * t],
      [near.x, near.top + (near.bottom - near.top) * t],
    ];
    ctx.strokeStyle = '#ffe0ac'; ctx.lineWidth = Math.max(1, scale * 3);
    for (const t of [.22, .37, .52]) {
      ctx.beginPath(); ctx.moveTo(...stripe(t)[0]); ctx.lineTo(...stripe(t)[1]); ctx.stroke();
    }
    ctx.strokeStyle = '#593448'; ctx.lineWidth = Math.max(1, scale * 5);
    for (const t of [.7, .81]) {
      ctx.beginPath(); ctx.moveTo(...stripe(t)[0]); ctx.lineTo(...stripe(t)[1]); ctx.stroke();
    }
    ctx.fillStyle = '#dbc29c';
    ctx.fillRect(Math.round(near.x - side * 2), Math.round(near.top), Math.max(1, scale * 3), Math.max(1, scale * 5));
  } else {
    ctx.strokeStyle = '#899392'; ctx.lineWidth = Math.max(1, scale * 2);
    for (const t of [.2, .38, .56, .74]) {
      ctx.beginPath();
      ctx.moveTo(far.x, far.top + (far.bottom - far.top) * t);
      ctx.lineTo(near.x, near.top + (near.bottom - near.top) * t);
      ctx.stroke();
    }
  }
}

function drawPassingWalls(ctx, distance) {
  // Each bay is a section of wall along the alley, projected between two
  // depths. Its leading pillar moves from the foreground edge inward toward
  // the vanishing point. The brick courses slope with that same depth.
  const bayLength = 12;
  const bayFirst = Math.floor((distance - REAR_DISTANCE) / bayLength);
  const bayLast = Math.ceil((distance + FOREGROUND_DISTANCE) / bayLength);
  for (let section = bayFirst; section <= bayLast; section += 1) {
    const farAhead = section * bayLength - distance;
    const nearAhead = farAhead + bayLength;
    if (nearAhead < -REAR_DISTANCE || farAhead > FOREGROUND_DISTANCE) continue;
    const farY = trackY(Math.max(-REAR_DISTANCE, farAhead));
    const nearY = trackY(Math.min(FOREGROUND_DISTANCE, nearAhead));
    const farTop = wallTopY(farY);
    const nearTop = wallTopY(nearY);
    for (const side of [-1, 1]) {
      const farX = W / 2 + side * roadHalfWidth(farY);
      const nearX = W / 2 + side * roadHalfWidth(nearY);
      drawBrickBay(ctx, { x: farX, top: farTop, foot: farY },
        { x: nearX, top: nearTop, foot: nearY }, section, side);
    }
  }

  // Doors, loading shutters, and windows are fixed to the world. Their feet
  // enter below the screen, travel past the runner, and recede toward the rock.
  const first = Math.floor((distance - REAR_DISTANCE - 8) / 18);
  const last = Math.ceil((distance + FOREGROUND_DISTANCE - 8) / 18);
  for (let section = first; section <= last; section += 1) {
    const ahead = section * 18 + 8 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const y = trackY(ahead);
    if (y < HORIZON + 20 || y > H + 45) continue;
    for (const side of [-1, 1]) {
      const detail = markNoise(section * 3 + side);
      if (detail < .17) continue;
      drawWallOpening(ctx, ahead, side, detail > .53 ? 'door' : 'window');
    }
  }

  // Small world-space posters and vents interrupt the repeated brick bays.
  const detailFirst = Math.floor((distance - REAR_DISTANCE - 17) / 38);
  const detailLast = Math.ceil((distance + FOREGROUND_DISTANCE - 17) / 38);
  for (let section = detailFirst; section <= detailLast; section += 1) {
    const ahead = section * 38 + 17 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    drawWallDetail(ctx, ahead, section % 2 === 0 ? -1 : 1, section % 3 !== 1);
  }

  const lampFirst = Math.floor((distance - REAR_DISTANCE - 14) / 48);
  const lampLast = Math.ceil((distance + FOREGROUND_DISTANCE - 14) / 48);
  for (let section = lampFirst; section <= lampLast; section += 1) {
    const ahead = section * 48 + 14 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    drawWallLamp(ctx, ahead, section % 2 === 0 ? -1 : 1);
  }

  // One sign passes at a time; it never stays pinned to the screen.
  const signFirst = Math.floor((distance - REAR_DISTANCE + 12) / 96);
  const signLast = Math.ceil((distance + FOREGROUND_DISTANCE + 12) / 96);
  for (let section = signFirst; section <= signLast; section += 1) {
    const ahead = section * 96 - 12 - distance;
    if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) continue;
    const footY = trackY(ahead);
    if (footY < HORIZON + 24 || footY > H + 35) continue;
    const scale = Math.max(0, (footY - HORIZON) / (H - HORIZON));
    const y = footY - 290 * scale;
    const t = Math.max(0, Math.min(1, (footY - HORIZON) / (PLAYER_GROUND_Y - HORIZON)));
    const wallWidth = W / 2 - roadHalfWidth(Math.min(footY, H));
    const width = 18 + t * 27;
    const height = 11 + t * 15;
    const x = W - wallWidth * .55 - width / 2;
    ctx.save();
    const wallX = W / 2 + roadHalfWidth(Math.min(footY, H));
    ctx.strokeStyle = '#898279'; ctx.lineWidth = Math.max(1, t * 2);
    ctx.beginPath(); ctx.moveTo(wallX + 2, y - 7);
    ctx.lineTo(x + width / 2, y - 7);
    ctx.lineTo(x + width / 2, y); ctx.stroke();
    ctx.fillStyle = '#29262b'; ctx.fillRect(x, y, width, height);
    ctx.shadowColor = '#e75a9b'; ctx.shadowBlur = 12;
    ctx.strokeStyle = '#e75a9b'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.font = `bold ${Math.round(5 + t * 5)}px monospace`;
    ctx.textAlign = 'center'; ctx.fillStyle = '#ff9bc7';
    ctx.fillText('OPEN', x + width / 2, y + height * .67);
    ctx.restore();
  }
}

function drawBackdrop(ctx, state) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#171c2c');
  sky.addColorStop(0.32, '#332b3c');
  sky.addColorStop(0.7, '#514044');
  sky.addColorStop(1, '#14181d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const dusk = ctx.createRadialGradient(W / 2, 167, 5, W / 2, 167, 230);
  dusk.addColorStop(0, 'rgba(205,123,101,.46)');
  dusk.addColorStop(.55, 'rgba(101,72,107,.2)');
  dusk.addColorStop(1, 'rgba(32,36,52,0)');
  ctx.fillStyle = dusk;
  ctx.fillRect(0, 0, W, 310);
  polygon(ctx, [[112, 191], [112, 170], [130, 170], [130, 157], [145, 157], [145, 181],
    [162, 181], [162, 164], [178, 164], [178, 194]], '#242630');
  polygon(ctx, [[180, 194], [180, 177], [195, 177], [195, 158], [210, 158],
    [210, 170], [228, 170], [228, 194]], '#282832');

  // A narrow strip of concrete is enclosed by two brick planes. Their inner
  // edges follow the road perspective, making the walls read as close surfaces.
  const concrete = ctx.createLinearGradient(0, HORIZON, 0, H);
  concrete.addColorStop(0, '#22272d');
  concrete.addColorStop(.58, '#2c3032');
  concrete.addColorStop(1, '#353435');
  polygon(ctx, [[0, HORIZON], [W, HORIZON], [W, H], [0, H]], concrete);
  const nearEdge = W / 2 - roadHalfWidth(H);
  polygon(ctx, [[0, -24], [170, 88], [nearEdge, H], [0, H]], '#392d33');
  polygon(ctx, [[W, -24], [190, 88], [W - nearEdge, H], [W, H]], '#332b33');
  polygon(ctx, [[0, -24], [170, 88], [170, 99], [0, -6]], '#514047');
  polygon(ctx, [[W, -24], [190, 88], [190, 99], [W, -6]], '#493b43');

  drawPassingWalls(ctx, state.distance);
  drawPassingGround(ctx, state.distance);
  for (const side of [-1, 1]) {
    const x = side < 0 ? nearEdge : W - nearEdge;
    polygon(ctx, [[180 + side * 10, 120], [180 + side * 15, 120], [x + side * 5, H], [x - side * 3, H]], side < 0 ? '#604947' : '#534548');
    ctx.strokeStyle = 'rgba(235,168,117,.43)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(180 + side * 10, 120); ctx.lineTo(x - side * 3, H); ctx.stroke();
  }

}

function laneX(lane, t) {
  const centeredOffset = LANE_OFFSETS[lane] ?? 0;
  const spread = 8 + t * 68;
  return W / 2 + centeredOffset * spread;
}

function laneXAtAhead(lane, ahead) {
  const offset = LANE_OFFSETS[lane] ?? 0;
  const spread = ahead >= 0
    ? 76 + Math.min(1, ahead / FOREGROUND_DISTANCE) * 35
    : 8 + Math.max(0, 1 + ahead / REAR_DISTANCE) * 68;
  return W / 2 + offset * spread;
}

function drawFlattenedObstacle(ctx, x, y, scale, type) {
  const colour = type === 'wheelie-bin' ? '#42665f'
    : type === 'bin-bag' ? '#282a30' : '#966344';
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0,0,0,.34)';
  ctx.beginPath(); ctx.ellipse(0, 4, 28, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colour; ctx.strokeStyle = '#c39570'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -2, 24, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(209,190,166,.4)';
  ctx.beginPath(); ctx.arc(-25, -11, 5, 0, Math.PI * 2); ctx.arc(24, -10, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawObstacle(ctx, obstacle, state) {
  const ahead = obstacle.distance - state.distance;
  if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) return;
  const x = laneXAtAhead(obstacle.lane, ahead);
  const y = trackY(ahead);
  const s = ahead >= 0
    ? 1 + Math.min(1, ahead / FOREGROUND_DISTANCE) * .5
    : .18 + Math.max(0, 1 + ahead / REAR_DISTANCE) * .82;
  const boulder = boulderGeometry(state);
  const boulderFoot = boulder.y + boulder.radius * .85;
  if (ahead < 0 && y <= boulderFoot) {
    if (y >= boulderFoot - 55) drawFlattenedObstacle(ctx, x, y, s, obstacle.type);
    return;
  }
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.36)';
  ctx.beginPath(); ctx.ellipse(0, 4, 27, 8, 0, 0, Math.PI * 2); ctx.fill();
  switch (obstacle.type) {
    case 'bin-bag':
      ctx.fillStyle = '#17191d';
      polygon(ctx, [[-19, -3], [-23, -21], [-14, -29], [-5, -26], [2, -32], [17, -24], [21, -5], [14, 1]], '#191a20', '#4b4950', 2);
      ctx.fillStyle = 'rgba(135,143,154,.28)'; ctx.fillRect(-13, -20, 14, 3); break;
    case 'wheelie-bin':
      ctx.fillStyle = '#42665f'; ctx.fillRect(-17, -39, 34, 38);
      ctx.fillStyle = '#273e3a'; ctx.fillRect(-20, -42, 40, 6);
      ctx.fillStyle = '#11171a'; ctx.beginPath(); ctx.arc(-12, 0, 5, 0, Math.PI * 2); ctx.arc(12, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#88a58d'; ctx.fillRect(-12, -33, 3, 22); break;
    case 'crate-stack':
      ctx.fillStyle = '#8a5639'; ctx.fillRect(-23, -28, 22, 27); ctx.fillRect(1, -37, 22, 36);
      ctx.strokeStyle = '#c18858'; ctx.lineWidth = 2; ctx.strokeRect(-23, -28, 22, 27); ctx.strokeRect(1, -37, 22, 36);
      ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(-4, -5); ctx.moveTo(4, -32); ctx.lineTo(20, -6); ctx.stroke(); break;
    case 'pallet':
      ctx.fillStyle = '#8b6346'; ctx.fillRect(-27, -18, 54, 6); ctx.fillRect(-24, -9, 48, 6); ctx.fillRect(-20, -3, 9, 7); ctx.fillRect(11, -3, 9, 7);
      ctx.strokeStyle = '#c19163'; ctx.lineWidth = 2; ctx.strokeRect(-27, -18, 54, 6); break;
    default: // box
      polygon(ctx, [[-19, -3], [-19, -31], [0, -41], [20, -31], [20, -3]], '#966344', '#d19a64', 2);
      ctx.strokeStyle = '#e0b47e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(0, -5); ctx.moveTo(-15, -29); ctx.lineTo(0, -22); ctx.lineTo(16, -29); ctx.stroke();
  }
  ctx.restore();
}

function drawPickup(ctx, pickup, state) {
  if (pickup.collected) return;
  const ahead = pickup.distance - state.distance;
  if (ahead < -REAR_DISTANCE || ahead > FOREGROUND_DISTANCE) return;
  const x = laneXAtAhead(pickup.lane, ahead);
  const y = trackY(ahead);
  const s = ahead >= 0
    ? 1 + Math.min(1, ahead / FOREGROUND_DISTANCE) * .5
    : .18 + Math.max(0, 1 + ahead / REAR_DISTANCE) * .82;
  const boulder = boulderGeometry(state);
  if (ahead < 0 && y <= boulder.y + boulder.radius * .85) return;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(0, 3, 20, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (pickup.type === 'red-bull') {
    ctx.fillStyle = 'rgba(239,76,77,.22)'; ctx.fillRect(-19, -42, 38, 42);
    ctx.fillStyle = '#d8dedc'; ctx.fillRect(-13, -35, 26, 35);
    ctx.fillStyle = '#f7f0de'; ctx.fillRect(-11, -38, 22, 4);
    ctx.fillStyle = '#8d1728'; ctx.fillRect(-11, -32, 10, 26); ctx.fillRect(1, -18, 10, 12);
    ctx.fillStyle = '#25497d'; ctx.fillRect(1, -32, 10, 13); ctx.fillRect(-11, -5, 10, 5);
    ctx.fillStyle = '#f8dc84'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('RB', 0, -20);
    ctx.fillStyle = '#aab8bb'; ctx.fillRect(-10, 0, 20, 3);
  } else {
    ctx.fillStyle = 'rgba(238,240,255,.2)'; ctx.fillRect(-19, -31, 38, 32);
    ctx.fillStyle = '#b6c3c4'; ctx.fillRect(-14, -27, 28, 27);
    ctx.fillStyle = '#2d424b'; ctx.fillRect(-12, -24, 24, 21);
    ctx.fillStyle = '#d978a2'; ctx.fillRect(-14, -29, 28, 4);
    ctx.fillStyle = '#f3f1df';
    polygon(ctx, [[-10, -6], [-6, -15], [0, -12], [5, -18], [11, -7], [11, -3], [-10, -3]], '#f3f1df');
    ctx.fillStyle = '#fff7d8';
    for (const [px, py] of [[-20, -31], [20, -23], [-22, -12], [19, -6]]) ctx.fillRect(px, py, 3, 3);
  }
  ctx.restore();
}

function boulderGeometry(state, captureProgress = null) {
  const caught = captureProgress !== null;
  const gapUsed = 100 - state.gap;
  return {
    x: W / 2,
    y: caught ? 322 + captureProgress * 286 : 290 + gapUsed * 1.25,
    radius: caught ? 103 + captureProgress * 54 : 99 + gapUsed * .26,
  };
}

let boulderSprite;

function getBoulderSprite() {
  if (boulderSprite) return boulderSprite;
  const sprite = document.createElement('canvas');
  sprite.width = 64; sprite.height = 64;
  const ink = sprite.getContext('2d');
  ink.imageSmoothingEnabled = false;
  ink.fillStyle = '#22262d';
  ink.beginPath(); ink.arc(32, 32, 31, 0, Math.PI * 2); ink.fill();
  ink.fillStyle = '#5a5c59';
  ink.beginPath(); ink.arc(32, 32, 28, 0, Math.PI * 2); ink.fill();
  ink.save();
  ink.beginPath(); ink.arc(32, 32, 28, 0, Math.PI * 2); ink.clip();
  polygon(ink, [[2, 11], [23, 3], [40, 8], [29, 19], [13, 23], [5, 35]], '#999c8d');
  polygon(ink, [[13, 23], [29, 19], [41, 8], [58, 19], [48, 34], [31, 30]], '#777c76');
  polygon(ink, [[5, 35], [13, 23], [31, 30], [37, 43], [18, 53], [4, 48]], '#646a68');
  polygon(ink, [[31, 30], [48, 34], [59, 25], [64, 53], [43, 64], [37, 43]], '#494c50');
  polygon(ink, [[18, 53], [37, 43], [43, 64], [9, 64]], '#3a3d42');
  ink.fillStyle = '#b0ae9a';
  for (const [x, y, w] of [[12, 13, 10], [15, 16, 13], [22, 10, 7], [9, 27, 4]]) ink.fillRect(x, y, w, 2);
  ink.fillStyle = '#33383d';
  for (const [x, y, w, h] of [[16, 34, 8, 3], [20, 37, 6, 2], [43, 16, 7, 3], [46, 19, 5, 2], [31, 49, 9, 3], [27, 52, 7, 2]]) ink.fillRect(x, y, w, h);
  ink.fillStyle = '#878a80';
  for (const [x, y, w] of [[10, 32, 5], [28, 24, 5], [41, 42, 4], [23, 47, 3]]) ink.fillRect(x, y, w, 2);
  ink.restore();
  boulderSprite = sprite;
  return sprite;
}

function drawBoulder(ctx, state, captureProgress = null) {
  // The stone stays in the middle; it grows and rolls down over every lane on capture.
  const { x, y, radius } = boulderGeometry(state, captureProgress);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.36)'; ctx.beginPath(); ctx.ellipse(x, y + radius * 0.86, radius * 1.12, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(x, y);
  ctx.rotate(state.time * .48);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getBoulderSprite(), -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

const LOOKS = {
  adelaide: ['#2a1720', '#f3e6d7', '#111319', 'curl'],
  sophia: ['#101116', '#18191e', '#e8ded2', 'long'],
  sass: ['#8a5236', '#c52b45', '#e9c578', 'long'],
  bambi: ['#ecd7a8', '#17191c', '#e7c67c', 'pony'],
  mrbryshanagy: ['#814a2f', '#b98a54', '#355c8c', 'beard'],
  mrsbryshanagy: ['#17151d', '#4659b7', '#d5c8e6', 'long'],
};
const SPRITE_ORDER = ['adelaide', 'sophia', 'sass', 'bambi', 'mrbryshanagy', 'mrsbryshanagy'];

function drawRunner(ctx, state, opts) {
  if (opts.spriteSheet) {
    const index = SPRITE_ORDER.indexOf(state.handle);
    if (index >= 0) {
      const flat = state.status === 'caught';
      const gait = opts.reducedMotion || state.status !== 'running' ? 0 : Math.sin(state.time * 15);
      const bob = opts.reducedMotion ? 0 : Math.abs(gait) * -3;
      const x = laneX(state.lane, 1);
      const y = 548 + bob;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(x, y);
      ctx.scale(1.42, 1.9);
      if (state.stumbleTime > 0 && !flat) {
        ctx.translate(0, 13);
        ctx.scale(1.14, .68);
      }
      if (flat) ctx.drawImage(opts.spriteSheet, index * 64, 128, 64, 48, -39, -37, 78, 37);
      else if (state.stumbleTime > 0 || opts.reducedMotion) {
        ctx.drawImage(opts.spriteSheet, index * 64, 0, 64, 128, -32, -128, 64, 128);
      } else {
        const sourceX = index * 64;
        // Slice the standing pose at shoulders and hips. Arms counter-swing
        // against the legs, keeping the authored face and costume intact.
        for (const [sourceOffset, hipX, direction] of [[14, -9, 1], [32, 9, -1]]) {
          const step = gait * direction;
          ctx.save();
          ctx.translate(hipX + step * 2, -58 + Math.max(0, step) * 4 - Math.max(0, -step) * 9);
          ctx.rotate(step * .07);
          ctx.scale(1 + Math.max(0, step) * .04, 1 - Math.max(0, -step) * .05);
          ctx.drawImage(opts.spriteSheet, sourceX + sourceOffset, 70, 18, 58, -9, 0, 18, 58);
          ctx.restore();
        }
        ctx.drawImage(opts.spriteSheet, sourceX + 16, 40, 32, 40, -16, -88, 32, 40);
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(side * 16, -88 - gait * side * 4);
          ctx.rotate(-side * gait * .14);
          ctx.drawImage(opts.spriteSheet, sourceX + (side < 0 ? 0 : 48), 40, 16, 40, side < 0 ? -16 : 0, 0, 16, 40);
          ctx.restore();
        }
        ctx.drawImage(opts.spriteSheet, sourceX, 0, 64, 40, -32 + gait, -128, 64, 40);
      }
      ctx.restore();
      return;
    }
  }
  const [hair, outfit, accent, style] = LOOKS[state.handle] || LOOKS.adelaide;
  const stumble = state.stumbleTime > 0;
  const bob = opts.reducedMotion ? 0 : Math.sin(state.time * 13) * 3;
  const x = laneX(state.lane, 1);
  const y = 524 + bob;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.2, 1.55);
  if (stumble) { ctx.translate(0, 14); ctx.scale(1.22, 0.55); }
  // Long hair shapes behind shoulders.
  ctx.fillStyle = hair;
  if (style === 'long') {
    polygon(ctx, [[-18, -81], [-29, -49], [-26, 2], [-18, 13], [-10, -43]], hair);
    polygon(ctx, [[18, -81], [29, -49], [26, 2], [18, 13], [10, -43]], hair);
  } else if (style === 'pony') {
    ctx.beginPath(); ctx.ellipse(25, -66, 9, 26, -.25, 0, Math.PI * 2); ctx.fill();
  }
  // Head and the approved silhouette cues as deliberately simple placeholders.
  const skin = state.handle === 'sass' ? '#ac6d47' : '#d8a77f';
  ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, -74, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
  if (style === 'curl') {
    ctx.fillStyle = hair;
    for (const [cx, cy, r] of [[-15, -88, 9], [-6, -98, 10], [6, -98, 10], [16, -87, 9], [-18, -75, 8], [18, -74, 8]]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#101116'; ctx.beginPath(); ctx.moveTo(3, -103); ctx.lineTo(10, -113); ctx.lineTo(16, -102); ctx.fill();
  } else if (style === 'beard') {
    ctx.fillStyle = hair; polygon(ctx, [[-13, -69], [0, -57], [13, -69], [10, -81], [-10, -81]], hair);
  } else {
    ctx.fillStyle = hair; ctx.fillRect(-17, -91, 34, 12);
  }
  // Eyes and nose keep the figure front-facing at game scale.
  ctx.fillStyle = '#282129'; ctx.fillRect(-7, -76, 3, 2); ctx.fillRect(5, -76, 3, 2);
  ctx.fillStyle = '#b87b65'; ctx.fillRect(-1, -72, 2, 5);
  // Arms, torso and running legs.
  ctx.strokeStyle = skin; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-15, -49); ctx.lineTo(-26, -30 + bob * .4); ctx.lineTo(-19, -15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15, -49); ctx.lineTo(26, -34 - bob * .4); ctx.lineTo(20, -18); ctx.stroke();
  ctx.fillStyle = outfit; polygon(ctx, [[-16, -53], [-12, -61], [12, -61], [17, -52], [14, -20], [-14, -20]], outfit, '#101116', 2);
  ctx.fillStyle = accent;
  if (state.handle === 'adelaide' || state.handle === 'mrsbryshanagy') {
    ctx.fillRect(-8, -49, 16, 2); ctx.fillRect(-8, -43, 16, 2);
  } else if (state.handle === 'sass') {
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11, -48); ctx.lineTo(11, -26); ctx.stroke();
  } else if (state.handle === 'mrbryshanagy') {
    ctx.strokeStyle = '#26262b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, -50); ctx.lineTo(14, -27); ctx.stroke();
  }
  ctx.strokeStyle = state.handle === 'bambi' || state.handle === 'sophia' ? '#111319' : skin;
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-7, -21); ctx.lineTo(-13 - bob * .3, 1); ctx.lineTo(-17, 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7, -21); ctx.lineTo(13 + bob * .3, -1); ctx.lineTo(17, 15); ctx.stroke();
  ctx.fillStyle = state.handle === 'sophia' || state.handle === 'bambi' ? '#15161a' : accent;
  ctx.fillRect(-24, 12, 16, 6); ctx.fillRect(9, 12, 16, 6);
  ctx.restore();
}

/** Draw one frame into a 360 x 640 logical canvas. */
export function renderGame(ctx, state, opts = {}) {
  if (!ctx || !state) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(ctx, state);
  if (state.status !== 'caught') drawBoulder(ctx, state);
  for (const obstacle of state.obstacles) drawObstacle(ctx, obstacle, state);
  for (const pickup of state.pickups) drawPickup(ctx, pickup, state);
  drawRunner(ctx, state, opts);
  if (state.status === 'caught') {
    drawBoulder(ctx, state, Math.max(0, Math.min(1, opts.captureProgress ?? 0)));
    ctx.fillStyle = 'rgba(12,12,18,.42)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd18b'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillText('CAUGHT. STILL OVER THERE.', W / 2, 126);
  }
  ctx.restore();
}
