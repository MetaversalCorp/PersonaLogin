      const user = await this.pLnG.Login(MV.MVMF.Encode({ contact: GUEST_EMAIL, password: GUEST_EMAIL }));
      if (!user) {
        throw new Error("Guest login returned null user");
      }
      this.appendStatus(`Guest session started as "${[firstName, lastName].filter(Boolean).join(" ")}".`);
      this.updateStatusBadge("success");

      this.userSession = new UserSession(user);