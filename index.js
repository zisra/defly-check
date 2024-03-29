function readString(buffer, idx) {
  for (var n = buffer.getUint8(idx++), i = "", o = 0; o < n; o++) {
    var a =
      buffer.getUint8(idx + 2 * o + 1) |
      (buffer.getUint8(idx + 2 * o + 0) << 8);
    i += String.fromCharCode(a);
  }
  return i;
}

function writeString(buffer, idx, str) {
  buffer.setUint8(idx, str.length);
  for (let i = 0; i < str.length; i++) {
    const o = str.charCodeAt(i);
    buffer.setUint8(idx + 1 + 2 * i + 1, 255 & o);
    buffer.setUint8(idx + 1 + 2 * i + 0, o >>> 8);
  }
}

function getAddress(input) {
  const address = REGION_LIST.find((i) => i.alias === input.region);
  return {
    ws: `wss://${address.ws}.defly.io/${input.port}`,
    region: address.region,
  };
}

function jsonResponse(data, status = 200) {
  const json = JSON.stringify(data);
  return [
    json,
    {
      status,
      headers: {
        "content-type": "application/json;charset=UTF-8",
      },
    },
  ];
}

const REGION_LIST = [
  { region: "USE1", ws: "use4", alias: "use", name: "US East" },
  { region: "EU1", ws: "eu1-1", alias: "eu", name: "Europe" },
  // { region: 'TOK1', ws: 'tok2', alias: 'asia', name: 'Asia East'},
  {
    region: "AU",
    ws: "au2",
    alias: "au",
    name: "Australia",
    working: true,
  },
  { region: "TR", ws: "use5", alias: "tr", name: "Tournament" },
  { region: "USW1", ws: "usw4", alias: "usw", name: "US West" },
];

const TEAM_COLORS = {
  0: { color: "Black", hex: "000000" },
  1: { color: "Grey", hex: "4d4d4d" },
  2: { color: "Blue", hex: "3d5dff" },
  3: { color: "Red", hex: "fd3535" },
  4: { color: "Dark Green", hex: "008037" },
  5: { color: "Orange", hex: "ff8a2a" },
  6: { color: "Purple", hex: "924bff" },
  7: { color: "Sky Blue", hex: "55d5ff" },
  8: { color: "Green", hex: "18e21f" },
  9: { color: "Pink", hex: "f659ff" },
  10: { color: "Yellow", hex: "f7ff2a" },
  11: { color: "Rose", hex: "ff5eae" },
  12: { color: "Lime", hex: "93fe00" },
  13: { color: "Turquoise", hex: "00ffbb" },
};

function getTeams(input) {
  return new Promise((resolve, reject) => {
    const gamesPlayed = 0;
    const username = "Player";
    const skin = 1;

    async function join() {
      const regionFromInput = getAddress(input);
      if (!regionFromInput) return reject("Server needs to be use, usw, or eu");

      let socket = new WebSocket(regionFromInput.ws);

      socket.addEventListener("open", async (e) => {
        const sessionData = await fetch(
          `https://s.defly.io/?r=${regionFromInput.region}&m=1&u=Player&fu=Player`,
        );
        const sessionDataString = await sessionData.text();

        const session = sessionDataString.split(" ")[1];

        let socketBuffer = new DataView(
          new ArrayBuffer(
            2 + 2 * username.length + 1 + 2 * session.length + 4 + 4,
          ),
        );

        socketBuffer.setUint8(0, 1);
        writeString(socketBuffer, 1, username);
        writeString(socketBuffer, 2 + 2 * username.length, session);
        socketBuffer.setInt32(
          2 + 2 * username.length + 1 + 2 * session.length,
          skin,
        );
        socketBuffer.setInt32(
          2 + 2 * username.length + 1 + 2 * session.length + 4,
          gamesPlayed,
        );

        socket.send(socketBuffer.buffer);
      });

      socket.addEventListener("error", (err) => {
        reject(err.message);
      });

      let members = [];
      let tourneyTeams = null;
      let teamIDs = null;

      socket.addEventListener("message", (event) => {
        const message = new DataView(event.data);
        const code = message.getUint8(0);

        if (code === 29) {
          const ID = message.getInt32(1);
          let currentUsername = readString(message, 5);
          let currentSkin = message.getInt32(6 + 2 * currentUsername.length);
          let currentTeam = -1;
          let currentBadge =
            message.byteLength >= 6 + 2 * currentUsername.length + 4 + 4 + 1 &&
            message.getUint8(6 + 2 * currentUsername.length + 4 + 4);

          message.byteLength >= 6 + 2 * currentUsername.length + 4 + 4 - 1 &&
            (currentTeam = message.getInt32(
              6 + 2 * currentUsername.length + 4,
            ));

          members.push({
            currentUsername,
            ID,
            currentSkin,
            currentTeam,
            currentBadge,
          });
        } else if (code === 57) {
          teamIDs = readString(message, 1).replace(/ +/g, "").split("-");
        } else if (code === 59) {
          tourneyTeams = readString(message, 1).split(";");
        } else if (code === 35) {
          const results = [];
          const maxSize = message.getUint8(1);
          const teamCount = message.getUint8(2);

          let offset = 3;

          for (let i = 0; i < teamCount; i++) {
            const teamID = message.getUint32(offset);
            offset += 4;

            const mapPercent = Math.max(message.getFloat32(offset), 0);
            offset += 4;

            const available = message.getUint8(offset) != 0;
            offset += 1;

            const memberLimit = message.getUint8(offset);
            offset += 1;

            const players = [];

            for (let j = 0; j < memberLimit; j++) {
              const playerID = message.getInt32(offset);
              players.push({
                ID: playerID,
                name: null,
              });
              offset += 4;
            }

            const result = {
              teamID,
              mapPercent,
              maxSize,
              available,
              players,
            };

            results.push(result);
          }
          members.forEach((i) => {
            let team = results.find((o) => o.teamID === i.currentTeam);
            let member = team.players.find((o) => o.ID === i.ID);
            member.name = i.currentUsername;
            member.skin = i.currentSkin;
            member.badge = i.currentBadge;
          });

          results.forEach((i, index) => {
            if (teamIDs) {
              i.team = TEAM_COLORS[parseInt(teamIDs[index]) + 1] ?? {
                color: "Unknown",
                hex: "000000",
                colorID: parseInt(teamIDs[index]) + 1,
              };
            } else {
              i.team = TEAM_COLORS[i.teamID] ?? {
                color: "Unknown",
                hex: "000000",
                colorID: i.teamID,
              };
            }

            if (tourneyTeams) {
              i.team.color = tourneyTeams[index];
            }

            console.log(teamIDs);
            console.log(tourneyTeams);

            i.team.ID = i.teamID;
            delete i.teamID;
          });
          resolve(results);
          socket.close();
        }
      });
    }

    join();

    setTimeout(() => {
      reject("Timeout reached");
    }, 2000);
  });
}

export default {
  async fetch(request, env) {
    try {
      const { searchParams, pathname } = new URL(request.url);

      if (pathname === "/") {
        const region = searchParams.get("region");
        const port = searchParams.get("port");

        if (!region && !port)
          return new Response("Query missing", {
            status: 400,
          });

        const data = await getTeams({
          region,
          port,
        });

        return new Response(...jsonResponse(data));
      } else {
        return new Response("Not found", {
          status: 404,
        });
      }
    } catch (err) {
      return new Response(...jsonResponse(err, 500));
    }
  },
};
