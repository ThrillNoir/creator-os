// Short enough to read during a run; the creator's stumble lines rotate in order.
export const BANTER = {
  adelaide: {
    stumbles: ['NEIGHBOURHOOD HAZARD.', 'I KNOW THAT PAVEMENT.', 'BOW STILL SECURE.'],
    redBull: 'GIRL NEXT DOOR: EXPRESS.',
    powder: 'JUST BAKING SUPPLIES.',
  },
  sophia: {
    stumbles: ['PLATFORM INSPECTION.', 'THE STREET STARTED IT.', 'STILL ABOVE IT.'],
    redBull: 'PLATFORMS: TURBO MODE.',
    powder: 'VERY FINE STREET DUST.',
  },
  sass: {
    stumbles: ['FASHIONABLY HORIZONTAL.', 'PARTY STARTS ON THE FLOOR.', 'I CALL THAT AN ENTRANCE.'],
    redBull: 'PARTY ETA: IMPROVED.',
    powder: 'PARTY FAVOURS. OFFICIAL.',
  },
  bambi: {
    stumbles: ['YOUR DAD SAW NOTHING.', 'THAT WAS A POSE.', 'STILL HEADING TO DAD.'],
    redBull: "DAD'S WAITING. QUICK.",
    powder: "TELL DAD IT'S FLOUR.",
  },
  mrbryshanagy: {
    stumbles: ['CONTROLLED DESCENT.', 'THE TRAINERS OBJECT.', 'LETTING HER WIN. AGAIN.'],
    redBull: 'SORRY, LOVE. REFLEX.',
    powder: 'I CAN EXPLAIN, LOVE.',
  },
  mrsbryshanagy: {
    stumbles: ["HE DIDN'T SEE THAT.", 'STILL BEATING HIM.', "PAVEMENT'S ON HIS SIDE."],
    redBull: "HE'S NOT CATCHING UP.",
    powder: 'NOT ON THE JOINT ACCOUNT.',
  },
};

export function stumbleLine(handle, count) {
  const lines = BANTER[handle]?.stumbles || ["IT'S FINE."];
  return lines[(Math.max(1, count) - 1) % lines.length];
}

export function boostLine(handle, item) {
  const player = BANTER[handle];
  return item === 'powder' ? player?.powder || 'NOTHING TO DECLARE.'
    : player?.redBull || 'MAKING EXCELLENT TIME.';
}
