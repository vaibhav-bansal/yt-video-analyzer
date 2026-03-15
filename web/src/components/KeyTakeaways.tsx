interface KeyTakeawaysProps {
  takeaways: string[];
  streaming?: boolean;
}

export const KeyTakeaways = ({ takeaways, streaming }: KeyTakeawaysProps) => {
  return (
    <section className="section fade-in">
      <h3>Key Takeaways</h3>
      <ol className="takeaways-list">
        {takeaways.map((t, i) => (
          <li key={i}>
            {t}
            {streaming && i === takeaways.length - 1 && (
              <span className="streaming-cursor" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};
