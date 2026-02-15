module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    route: "/api/teams",
    teamId: req.query.teamId || null,
  });
};
