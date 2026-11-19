// Conversation starters for the interest tags two people share.
// Keyed by the tag's lower-case name; anything not listed gets a general one.

const STARTERS: Record<string, string[]> = {
  "hiking": ["What's the best hike you've done near here?", "Any trail you've been meaning to try?"],
  "coffee": ["Where's your go-to coffee spot?", "How do you take your coffee?"],
  "artisan products": ["Found any great local makers lately?", "What's the best handmade thing you own?"],
  "art": ["Seen any shows you loved recently?", "Do you make art, or mostly go see it?"],
  "swimming": ["Pool or open water?", "Where's your favourite place to swim around here?"],
  "rock climbing": ["Which gym do you climb at?", "Indoor, or do you get outside too?"],
  "climbing": ["Which gym do you climb at?", "Indoor, or do you get outside too?"],
  "bouldering": ["Which gym do you boulder at?", "What grade are you projecting right now?"],
  "dungeons & dragons": ["What class do you usually play?", "Are you in a campaign right now, or looking for one?"],
  "board games": ["What's your favourite board game right now?", "Up for a game night sometime?"],
  "running": ["What's your favourite running route?", "Training for anything at the moment?"],
  "yoga": ["Which studio do you go to?", "What got you into yoga?"],
  "cooking": ["What's the dish you're proudest of?", "Cooked anything new lately?"],
  "baking": ["What do you love baking most?", "Sourdough person or cake person?"],
  "photography": ["What do you like to shoot?", "Film or digital?"],
  "film": ["Seen anything great lately?", "What's a movie you could watch forever?"],
  "live music": ["Best show you've been to this year?", "Any favourite venues around here?"],
  "concerts": ["Best concert you've ever been to?", "Got any shows coming up?"],
  "reading": ["What are you reading right now?", "What's a book you always recommend?"],
  "travel": ["Where was your last trip?", "Where's next on your list?"],
  "surfing": ["Where do you usually surf?", "How long have you been surfing?"],
  "cycling": ["Got a favourite ride around here?", "Road, gravel or just getting around town?"],
  "skiing": ["Where do you usually ski?", "Going anywhere this season?"],
  "snowboarding": ["Where do you usually ride?", "Going anywhere this season?"],
  "tennis": ["Where do you play?", "Up for a hit sometime?"],
  "pickleball": ["Where do you play?", "Up for a game sometime?"],
  "gardening": ["What are you growing right now?", "Balcony pots or a proper garden?"],
  "plants": ["How many plants are you up to?", "Which one are you proudest of keeping alive?"],
  "wine": ["Got a favourite wine bar?", "Red, white or orange?"],
  "craft beer": ["What's your favourite brewery around here?", "What style are you into lately?"],
  "gaming": ["What are you playing right now?", "What's your all-time favourite game?"],
  "video games": ["What are you playing right now?", "What's your all-time favourite game?"],
  "anime": ["What are you watching right now?", "What would you recommend to a friend?"],
  "theatre": ["Seen a good show lately?", "What's the best thing you've seen on stage?"],
  "dancing": ["What kind of dancing are you into?", "Know a good place to go dancing?"],
  "volunteering": ["Where do you volunteer?", "What got you into it?"],
  "pottery": ["Where do you throw?", "What's the best thing you've made?"],
  "knitting": ["What's on your needles right now?", "Do you have a favourite yarn shop?"],
  "crochet": ["What are you making right now?", "How did you learn?"],
  "museums": ["What's your favourite museum around here?", "Seen a good exhibition lately?"],
  "trivia nights": ["Where do you do trivia?", "What's your best category?"],
  "karaoke": ["What's your go-to karaoke song?", "Know a good karaoke spot?"],
  "dogs": ["Do you have a dog?", "Know any good dog parks?"],
  "cats": ["Do you have a cat?", "What's your cat's name?"],
  "chess": ["Do you play online or in person?", "Up for a game sometime?"],
  "camping": ["Favourite place you've camped?", "Tent, van or cabin?"],
  "brunch": ["Where's your favourite brunch spot?", "Sweet or savoury brunch?"],
  "foodie": ["What's the best thing you've eaten lately?", "Any restaurant you're dying to try?"],
  "podcasts": ["What podcasts are you into?", "Any episode you'd recommend?"],
  "comedy": ["Seen any good comedy lately?", "Who always makes you laugh?"],
  "festivals": ["Best festival you've been to?", "Going to any this year?"],
  "meditation": ["How did you get into meditating?", "Do you use an app, or go to a group?"],
  "tea": ["What's your favourite tea?", "Know any good tea shops?"],
};

// "Board games" reads as "board games" mid-sentence; "Dungeons & Dragons" stays as is.
const inline = (name: string) => (name.slice(1) === name.slice(1).toLowerCase() ? name.toLowerCase() : name);

/** Up to `max` conversation starters for the tags you share, one per tag first. */
export function conversationStarters(shared: string[], max = 3): string[] {
  const out: string[] = [];
  const lists = shared.map((name) => STARTERS[name.toLowerCase()] ?? [`What got you into ${inline(name)}?`]);
  // One from each shared tag before a second from any.
  for (let round = 0; out.length < max && lists.some((l) => l[round]); round++) {
    for (const l of lists) {
      if (out.length >= max) break;
      if (l[round]) out.push(l[round]);
    }
  }
  if (shared.length >= 2 && out.length < max) {
    out.push(`You both like ${inline(shared[0])} and ${inline(shared[1])}. Want to do one together?`);
  }
  return out;
}
