import { useMemo, useState } from "react";
import { BarChart3, Calculator, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTrueRankStore } from "../lib/store";

export const ROIForecaster = () => {
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const dashboard = useTrueRankStore((s) => s.dashboard);

  const [closeRate, setCloseRate] = useState(6.5);
  const [avgGrossProfit, setAvgGrossProfit] = useState(2600);
  const [serviceCloseRate, setServiceCloseRate] = useState(14);
  const [avgRepairOrder, setAvgRepairOrder] = useState(420);

  const monthlyBudget = useMemo(
    () => campaigns.reduce((sum, campaign) => sum + campaign.monthlyBudgetEstimate, 0),
    [campaigns]
  );

  const data = useMemo(() => {
    const clicks = Math.max(dashboard.totalClicks, 1);
    const salesLeads = clicks * 0.46;
    const soldUnits = salesLeads * (closeRate / 100);
    const salesNet = soldUnits * avgGrossProfit - monthlyBudget;
    const salesRoi = monthlyBudget > 0 ? (salesNet / monthlyBudget) * 100 : 0;

    const serviceLeads = clicks * 0.52;
    const repairOrders = serviceLeads * (serviceCloseRate / 100);
    const serviceNet = repairOrders * avgRepairOrder - monthlyBudget * 0.25;
    const serviceRoi = monthlyBudget > 0 ? (serviceNet / (monthlyBudget * 0.25 || 1)) * 100 : 0;

    return {
      salesNet,
      salesRoi,
      serviceNet,
      serviceRoi,
      chartData: [
        { week: "Wk 1", sales: salesNet * 0.15, service: serviceNet * 0.2 },
        { week: "Wk 2", sales: salesNet * 0.38, service: serviceNet * 0.45 },
        { week: "Wk 3", sales: salesNet * 0.67, service: serviceNet * 0.72 },
        { week: "Wk 4", sales: salesNet, service: serviceNet }
      ]
    };
  }, [dashboard.totalClicks, closeRate, avgGrossProfit, monthlyBudget, serviceCloseRate, avgRepairOrder]);

  return (
    <div className="mx-auto max-w-7xl animate-fade-in space-y-8 p-6 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-display text-white">
            <BarChart3 className="text-tr-primary" /> TrueRank ROI Forecaster
          </h2>
          <p className="text-sm text-zinc-400">Model projected profit using live click volume and campaign budgets.</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Monthly Budget Observed</div>
          <div className="text-3xl font-black text-tr-secondary">${monthlyBudget.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div className="tr-glass relative overflow-hidden rounded-xl border border-white/10 p-6">
          <div className="absolute left-0 top-0 h-1 w-full bg-tr-primary" />
          <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-white">
            <Calculator className="text-tr-primary" size={18} /> Variable Ops (Vehicle Sales)
          </h3>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-sm font-semibold text-white">
                <span>Showroom Close Rate</span>
                <span className="text-tr-primary">{closeRate}%</span>
              </div>
              <input type="range" min="1" max="20" step="0.5" value={closeRate} onChange={(e) => setCloseRate(Number(e.target.value))} className="w-full accent-tr-primary" />
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm font-semibold text-white">
                <span>Avg Gross Profit / Unit</span>
                <span className="text-tr-primary">${avgGrossProfit.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="1000"
                max="6000"
                step="100"
                value={avgGrossProfit}
                onChange={(e) => setAvgGrossProfit(Number(e.target.value))}
                className="w-full accent-tr-primary"
              />
            </div>

            <div className="flex justify-between rounded-xl border border-white/10 bg-black/30 p-4">
              <div>
                <div className="text-xs uppercase text-zinc-400">Projected Net</div>
                <div className="text-2xl font-black text-white">${data.salesNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-zinc-400">ROI</div>
                <div className="text-2xl font-black text-tr-secondary">{data.salesRoi.toLocaleString(undefined, { maximumFractionDigits: 0 })}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="tr-glass relative overflow-hidden rounded-xl border border-white/10 p-6">
          <div className="absolute left-0 top-0 h-1 w-full bg-yellow-500" />
          <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-white">
            <Calculator className="text-yellow-500" size={18} /> Fixed Ops (Service Sniping)
          </h3>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-sm font-semibold text-white">
                <span>Service Close Rate</span>
                <span className="text-yellow-500">{serviceCloseRate}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                step="1"
                value={serviceCloseRate}
                onChange={(e) => setServiceCloseRate(Number(e.target.value))}
                className="w-full accent-yellow-500"
              />
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm font-semibold text-white">
                <span>Avg Repair Order Value</span>
                <span className="text-yellow-500">${avgRepairOrder.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="150"
                max="1500"
                step="25"
                value={avgRepairOrder}
                onChange={(e) => setAvgRepairOrder(Number(e.target.value))}
                className="w-full accent-yellow-500"
              />
            </div>

            <div className="flex justify-between rounded-xl border border-white/10 bg-black/30 p-4">
              <div>
                <div className="text-xs uppercase text-zinc-400">Projected Service Net</div>
                <div className="text-2xl font-black text-white">${data.serviceNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-zinc-400">ROI</div>
                <div className="text-2xl font-black text-tr-secondary">{data.serviceRoi.toLocaleString(undefined, { maximumFractionDigits: 0 })}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tr-glass h-72 rounded-xl border border-white/10 p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
          <TrendingUp className="text-zinc-400" size={18} /> 30-Day Profit Velocity
        </h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e60000" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#e60000" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorService" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#eab308" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
            <XAxis dataKey="week" stroke="#a3a3a3" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              stroke="#a3a3a3"
              tick={{ fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `$${Number(value) / 1000}k`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#141414", borderColor: "#262626", color: "#fff", borderRadius: "8px" }}
              formatter={(value) => [`$${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, ""]}
            />
            <Area type="monotone" dataKey="sales" stroke="#e60000" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
            <Area type="monotone" dataKey="service" stroke="#eab308" strokeWidth={3} fillOpacity={1} fill="url(#colorService)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
