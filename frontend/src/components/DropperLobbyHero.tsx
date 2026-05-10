/** Превью до «Играть»: сцена из ассета + лес вокруг задаётся в CSS (.mysub-dropper-cliff). */
export default function DropperLobbyHero() {
  return (
    <div className="mysub-dropper-lobby-scene">
      <img
        src="/dropper-lobby-scene.png"
        alt=""
        className="mysub-dropper-lobby-scene-img"
        width={280}
        height={200}
        decoding="async"
      />
    </div>
  );
}
