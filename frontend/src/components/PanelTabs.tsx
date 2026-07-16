export type PanelTabItem<T extends string> = {
  id: T;
  label: string;
};

type PanelTabsProps<T extends string> = {
  tabs: PanelTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

export default function PanelTabs<T extends string>({ tabs, value, onChange, className }: PanelTabsProps<T>) {
  return (
    <section className={`panel referral-tabs-bar panel-tabs-bar${className ? ` ${className}` : ""}`}>
      <div className="referral-main-tabs panel-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            className={value === tab.id ? "active" : ""}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </section>
  );
}
