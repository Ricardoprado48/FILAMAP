#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdlib>
#include <iostream>
#include <string>

struct FilamentQueryParams
{
    std::string category;
    std::string status;
    std::string spool_id;
    std::string rfid;
    int offset = 0;
    int limit = 100;
};

using CreateAgentFn       = void* (__cdecl *)(std::string);
using DestroyAgentFn      = int   (__cdecl *)(void*);
using InitLogFn           = int   (__cdecl *)(void*);
using SetConfigDirFn      = int   (__cdecl *)(void*, std::string);
using SetCountryCodeFn    = int   (__cdecl *)(void*, std::string);
using StartFn             = int   (__cdecl *)(void*);
using IsUserLoginFn       = bool  (__cdecl *)(void*);
using GetFilamentSpoolsFn = int   (__cdecl *)(void*, FilamentQueryParams, std::string*);

template <typename T>
T load_proc(HMODULE module, const char* name)
{
    auto ptr = reinterpret_cast<T>(GetProcAddress(module, name));

    if (!ptr) {
        std::cerr << "Funcao ausente: " << name << "\n";
        ExitProcess(10);
    }

    return ptr;
}

int main(int argc, char* argv[])
{
    bool jsonOnly = false;

    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--json") {
            jsonOnly = true;
        }
    }

    char* appdataRaw = nullptr;
    size_t appdataLen = 0;

    if (_dupenv_s(&appdataRaw, &appdataLen, "APPDATA") != 0 || !appdataRaw) {
        std::cerr << "APPDATA nao encontrado.\n";
        return 1;
    }

    std::string appdata(appdataRaw);
    free(appdataRaw);

    const std::string configDir =
        appdata + "\\BambuStudio";

    const std::string pluginDir =
        configDir + "\\plugins";

    const std::string dllPath =
        pluginDir + "\\bambu_networking.dll";

    SetDllDirectoryA(pluginDir.c_str());

    HMODULE module = LoadLibraryA(dllPath.c_str());

    if (!module) {
        std::cerr
            << "Falha ao carregar bambu_networking.dll. Win32Error="
            << GetLastError()
            << "\n";
        return 2;
    }

    auto createAgent =
        load_proc<CreateAgentFn>(
            module,
            "bambu_network_create_agent"
        );

    auto destroyAgent =
        load_proc<DestroyAgentFn>(
            module,
            "bambu_network_destroy_agent"
        );

    auto initLog =
        load_proc<InitLogFn>(
            module,
            "bambu_network_init_log"
        );

    auto setConfigDir =
        load_proc<SetConfigDirFn>(
            module,
            "bambu_network_set_config_dir"
        );

    auto setCountryCode =
        load_proc<SetCountryCodeFn>(
            module,
            "bambu_network_set_country_code"
        );

    auto start =
        load_proc<StartFn>(
            module,
            "bambu_network_start"
        );

    auto isUserLogin =
        load_proc<IsUserLoginFn>(
            module,
            "bambu_network_is_user_login"
        );

    auto getFilamentSpools =
        load_proc<GetFilamentSpoolsFn>(
            module,
            "bambu_network_get_filament_spools"
        );

    void* agent = nullptr;
    int exitCode = 0;

    try {
        agent = createAgent(configDir + "\\log");

        if (!agent) {
            std::cerr << "create_agent retornou null.\n";
            // TESTE: FreeLibrary(module);
            return 3;
        }

        initLog(agent);
        setConfigDir(agent, configDir);
        setCountryCode(agent, "BR");

        const int startResult = start(agent);

        if (startResult != 0) {
            std::cerr
                << "bambu_network_start retornou "
                << startResult
                << "\n";
        }

        bool logged = false;

        for (int i = 0; i < 20; i++) {
            Sleep(500);

            if (isUserLogin(agent)) {
                logged = true;
                break;
            }
        }

        if (!logged) {
            std::cerr << "Sessao Bambu nao autenticada.\n";
            exitCode = 4;
        }
        else {
            FilamentQueryParams params;
            params.offset = 0;
            params.limit = 100;

            std::string body;

            const int ret =
                getFilamentSpools(
                    agent,
                    params,
                    &body
                );

            if (ret != 0) {
                std::cerr
                    << "get_filament_spools retornou "
                    << ret
                    << "\n";

                exitCode = 5;
            }
            else if (body.empty()) {
                std::cerr << "Resposta Bambu vazia.\n";
                exitCode = 6;
            }
            else {
                if (!jsonOnly) {
                    std::cout << "BAMBU_LOGIN=OK\n";
                    std::cout << "GET_FILAMENT_SPOOLS_RET=0\n";
                    std::cout << "\n=== JSON ===\n";
                }

                std::cout << body << "\n";
            }
        }
    }
    catch (const std::exception& ex) {
        std::cerr
            << "Exception: "
            << ex.what()
            << "\n";

        exitCode = 7;
    }
    catch (...) {
        std::cerr << "Exception desconhecida.\n";
        exitCode = 8;
    }

    // bambu_networking.dll mantem threads internas (rede/MQTT/discovery) vivas apos
    // start(); chamar destroyAgent()/FreeLibrary() aqui, ou simplesmente retornar de
    // main() e deixar o processo terminar normalmente, aciona o DLL_PROCESS_DETACH
    // dela enquanto essas threads ainda rodam, corrompendo a pilha (0xC0000409/0xC0000005
    // reproduzidos e confirmados via dump). TerminateProcess encerra o processo sem
    // notificar nenhuma DLL, evitando esse caminho de codigo por completo.
    (void)destroyAgent;

    std::cout.flush();
    std::cerr.flush();
    TerminateProcess(GetCurrentProcess(), (UINT)exitCode);
    return exitCode;
}

