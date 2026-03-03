handleGuestLogin() {
    // Existing code...
    const user = await pLnG.Login(...);

    // Null check for user
    if (!user) throw new Error("Guest login returned null user");

    // Proceed to create a new UserSession
    const session = new UserSession(user);
    // Existing code continues...
}